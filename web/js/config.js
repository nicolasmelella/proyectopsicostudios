// =====================================================================
// CONFIGURACIÓN DE CONEXIÓN A SUPABASE
// Los dos datos están en Supabase → Project Settings → API.
//   · Project URL          → SUPABASE_URL
//   · anon / public key    → SUPABASE_ANON_KEY
// La "anon key" es pública por diseño: puede estar acá sin riesgo.
// NUNCA pegues acá la "service_role key".
//
// Mientras diga COMPLETAR, la web funciona en MODO DEMO (datos de prueba).
// También es DEMO al abrirla en la propia compu (localhost) o agregando ?demo a la dirección.
// =====================================================================
export const SUPABASE_URL = 'https://rrqxmzxkxxxycwseyrsp.supabase.co';
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJycXhtenhreHh4eWN3c2V5cnNwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQxMzkxNzksImV4cCI6MjEwOTcxNTE3OX0.wFiz3U6IwCJwyn_1x7PmNCQ9q2lXggf1Ta-95c5iYkQ';

// WhatsApp de ayuda: botón "¿Tenés algún problema?", botón flotante y mensajes de error.
// Solo números: 54 + 9 + código de área + número.
export const WHATSAPP_AYUDA = '5491178224918';
