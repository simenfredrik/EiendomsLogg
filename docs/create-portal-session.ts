// Supabase Edge Function: create-portal-session
//
// Gir den innloggede brukeren en lenke til Stripes egen "Customer Portal" —
// der de selv kan si opp abonnementet, bytte betalingskort, eller se
// tidligere kvitteringer, helt uten at du (Simen) trenger å gjøre noe.
//
// Krever ingen nye secrets — bruker samme STRIPE_SECRET_KEY og SITE_URL
// som create-checkout-session allerede har.
//
// VIKTIG ENGANGSJOBB I STRIPE FØR DETTE VIRKER:
// Gå til Stripe → Settings → Billing → Customer portal, og aktiver den
// (fyll ut forretningsnavn, hvilke handlinger kunden får lov til — huk av
// "Cancel subscriptions" som et minimum). Uten dette steget feiler kallet.

import Stripe from 'https://esm.sh/stripe@17?target=denonext'
import { createClient } from 'jsr:@supabase/supabase-js@2'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '')
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

    const { data: profile, error: profileErr } = await supabaseClient
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', user.id)
      .single()

    if (profileErr || !profile || !profile.stripe_customer_id) {
      return new Response(JSON.stringify({ error: 'Fant ikke noe aktivt abonnement på denne kontoen.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${SITE_URL}/`,
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
