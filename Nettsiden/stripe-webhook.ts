// Supabase Edge Function: stripe-webhook
//
// Stripe kaller denne funksjonen direkte når noe skjer med en betaling
// eller et abonnement. Dette er fasiten på om noen faktisk har betalt —
// klienten (nettsiden) bestemmer ALDRI selv at noen er "subscribed".
//
// VIKTIG: Denne funksjonen må opprettes med "Enforce JWT Verification"
// AVSLÅTT (i funksjonsinnstillingene i Supabase-dashbordet), fordi Stripe
// ikke sender noen Supabase-innloggingstoken — signaturen verifiseres i
// stedet manuelt her i koden, med Stripes egen signeringsnøkkel.
//
// Miljøvariabler du må sette under Edge Functions → stripe-webhook → Secrets:
//   STRIPE_SECRET_KEY            (samme som i create-checkout-session)
//   STRIPE_WEBHOOK_SIGNING_SECRET (fra Stripe når du oppretter webhooken, whsec_...)
//
// SUPABASE_URL og SUPABASE_SERVICE_ROLE_KEY finnes automatisk i alle
// Edge Functions. Denne funksjonen bruker service-role-nøkkelen fordi den
// må kunne oppdatere andre brukeres rader (den kjører ikke som en
// innlogget bruker) — RLS-reglene på "profiles" hindrer ellers dette.

import Stripe from 'https://esm.sh/stripe@17?target=denonext'
import { createClient } from 'jsr:@supabase/supabase-js@2'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '')
const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SIGNING_SECRET') ?? ''
const cryptoProvider = Stripe.createSubtleCryptoProvider()

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
)

Deno.serve(async (req) => {
  const signature = req.headers.get('Stripe-Signature')
  if (!signature) {
    return new Response('Mangler signatur', { status: 400 })
  }

  // .text() er nødvendig — signaturverifisering krenger den rå kroppen,
  // ikke JSON som allerede er tolket.
  const body = await req.text()

  let event
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      webhookSecret,
      undefined,
      cryptoProvider
    )
  } catch (err) {
    console.error('Signaturfeil:', err.message)
    return new Response('Signaturfeil: ' + err.message, { status: 400 })
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object
      const userId = session.client_reference_id
      if (userId) {
        await supabaseAdmin.from('profiles').update({
          subscribed: true,
          plan: 'standard',
          subscribed_at: new Date().toISOString(),
          stripe_customer_id: session.customer,
          stripe_subscription_id: session.subscription,
        }).eq('id', userId)
      }
    }

    if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      const sub = event.data.object
      const isActive = sub.status === 'active' || sub.status === 'trialing'
      await supabaseAdmin.from('profiles')
        .update({ subscribed: isActive })
        .eq('stripe_subscription_id', sub.id)
    }
  } catch (err) {
    console.error('Feil ved oppdatering av profil:', err)
    // Vi returnerer likevel 200 til Stripe her for å unngå at de retry-er
    // i det uendelige på en feil som ligger hos oss, men loggen fanger det opp.
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
