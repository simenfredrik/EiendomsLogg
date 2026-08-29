// Supabase Edge Function: create-checkout-session
//
// Kalles av den innloggede brukeren fra nettsiden når de trykker
// "Gå til betaling". Oppretter en Stripe Checkout-økt og returnerer
// URL-en brukeren skal sendes til. Den hemmelige Stripe-nøkkelen bor
// kun her på serveren — aldri i nettsidekoden.
//
// Miljøvariabler du må sette under Edge Functions → create-checkout-session → Secrets:
//   STRIPE_SECRET_KEY   (fra Stripe: sk_test_... eller sk_live_...)
//   STRIPE_PRICE_ID     (Price-ID for det tilbakevendende abonnementet, price_...)
//   SITE_URL            (f.eks. https://din-side.no — uten skråstrek på slutten)
//
// SUPABASE_URL og SUPABASE_ANON_KEY finnes automatisk i alle Edge Functions,
// du trenger ikke sette dem selv.

import Stripe from 'https://esm.sh/stripe@17?target=denonext'
import { createClient } from 'jsr:@supabase/supabase-js@2'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '')
const PRICE_ID = Deno.env.get('STRIPE_PRICE_ID') ?? ''
const SITE_URL = Deno.env.get('SITE_URL') ?? ''

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Ikke innlogget' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: userData, error: userErr } = await supabaseClient.auth.getUser()
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: 'Ugyldig innlogging' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const user = userData.user

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: PRICE_ID, quantity: 1 }],
      customer_email: user.email,
      client_reference_id: user.id,
      success_url: `${SITE_URL}/?checkout=success`,
      cancel_url: `${SITE_URL}/?checkout=cancel`,
      allow_promotion_codes: true,
      // Stripes nye "Managed Payments" krever en skattekode på produktet
      // for å kunne brukes. Vi trenger den ikke, så den skrus eksplisitt av.
      managed_payments: { enabled: false },
    })

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
