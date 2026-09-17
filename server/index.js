import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import { ErlcClient } from 'erlc-api';

const app = express();
app.use(express.json({ limit: '256kb' }));
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',').map(x => x.trim()) || true }));

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);
const supabaseAuth = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const erlc = process.env.ERLC_SERVER_KEY
  ? new ErlcClient({ serverKey: process.env.ERLC_SERVER_KEY })
  : null;

const pollMs = Math.max(3000, Number(process.env.ERLC_POLL_MS || 5000));

function bearer(req) {
  const value = req.headers.authorization || '';
  return value.startsWith('Bearer ') ? value.slice(7) : null;
}

async function requireUser(req, res, permission = null) {
  const token = bearer(req);
  if (!token) return res.status(401).json({ error: 'Inloggning krävs.' });
  const { data, error } = await supabaseAuth.auth.getUser(token);
  if (error || !data?.user) return res.status(401).json({ error: 'Ogiltig session.' });

  if (permission) {
    const { data: allowed, error: permissionError } = await supabaseAdmin.rpc('has_permission', {
      uid: data.user.id,
      permission_name: permission
    });
    if (permissionError || !allowed) return res.status(403).json({ error: 'Saknar behörighet.' });
  }
  return data.user;
}

function commandAllowed(text, max = 180) {
  return typeof text === 'string' && text.trim().length > 0 && text.length <= max;
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, erlcConfigured: !!erlc });
});

app.post('/api/erlc/hint', async (req, res) => {
  const user = await requireUser(req, res, 'admin');
  if (!user || res.headersSent) return;
  const text = String(req.body?.text || '').trim();
  if (!commandAllowed(text)) return res.status(400).json({ error: 'Meddelandet är tomt eller för långt.' });
  if (!erlc) return res.status(503).json({ error: 'ER:LC-integrationen är inte konfigurerad.' });

  try {
    const command = `${process.env.ERLC_HINT_COMMAND || ':h'} ${text}`;
    const result = await erlc.commands.execute(command);
    await supabaseAdmin.from('roblox_events').insert({ event_type: 'admin_hint', payload: { user_id: user.id, command, result } });
    res.json({ ok: true, result });
  } catch (error) {
    console.error(error);
    res.status(502).json({ error: error?.message || 'ER:LC kunde inte ta emot kommandot.' });
  }
});

app.post('/api/erlc/message', async (req, res) => {
  const user = await requireUser(req, res, 'admin');
  if (!user || res.headersSent) return;
  const text = String(req.body?.text || '').trim();
  if (!commandAllowed(text)) return res.status(400).json({ error: 'Meddelandet är tomt eller för långt.' });
  if (!erlc) return res.status(503).json({ error: 'ER:LC-integrationen är inte konfigurerad.' });

  try {
    const command = `${process.env.ERLC_MESSAGE_COMMAND || ':m'} ${text}`;
    const result = await erlc.commands.execute(command);
    await supabaseAdmin.from('roblox_events').insert({ event_type: 'admin_message', payload: { user_id: user.id, command, result } });
    res.json({ ok: true, result });
  } catch (error) {
    console.error(error);
    res.status(502).json({ error: error?.message || 'ER:LC kunde inte ta emot kommandot.' });
  }
});

app.post('/api/erlc/pm', async (req, res) => {
  const user = await requireUser(req, res, 'admin');
  if (!user || res.headersSent) return;
  const player = String(req.body?.player || '').trim();
  const text = String(req.body?.text || '').trim();
  if (!commandAllowed(player, 50) || !commandAllowed(text)) return res.status(400).json({ error: 'Spelare eller meddelande saknas.' });
  if (!erlc) return res.status(503).json({ error: 'ER:LC-integrationen är inte konfigurerad.' });

  try {
    const command = `${process.env.ERLC_PM_COMMAND || ':pm'} ${player} ${text}`;
    const result = await erlc.commands.execute(command);
    await supabaseAdmin.from('roblox_events').insert({ event_type: 'admin_pm', payload: { user_id: user.id, player, command, result } });
    res.json({ ok: true, result });
  } catch (error) {
    console.error(error);
    res.status(502).json({ error: error?.message || 'ER:LC kunde inte skicka PM.' });
  }
});

app.post('/api/dispatch/on-duty', async (req, res) => {
  const user = await requireUser(req, res, 'dispatch');
  if (!user || res.headersSent) return;
  const callsign = String(req.body?.callsign || '').trim();
  const unitType = String(req.body?.unitType || 'patrol').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]{1,19}$/.test(callsign)) return res.status(400).json({ error: 'Ange ett giltigt enhetsnummer.' });

  const { data: existing } = await supabaseAdmin.from('dispatch_units').select('id').eq('user_id', user.id).limit(1);
  if (existing?.length) return res.status(409).json({ error: 'Du har redan en aktiv enhet.' });

  const { data, error } = await supabaseAdmin.from('dispatch_units').insert({
    callsign, unit_type: unitType, status: 'available', user_id: user.id
  }).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json({ ok: true, unit: data });
});

app.post('/api/dispatch/off-duty', async (req, res) => {
  const user = await requireUser(req, res, 'dispatch');
  if (!user || res.headersSent) return;
  const { error } = await supabaseAdmin.from('dispatch_units').delete().eq('user_id', user.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ ok: true });
});

async function syncEmergencyCalls() {
  if (!erlc) return;
  try {
    const calls = await erlc.server.emergencyCalls();
    for (const call of calls || []) {
      const externalId = String(call.Id ?? call.id ?? call.CallId ?? call.callId ?? `${call.Timestamp ?? call.timestamp ?? Date.now()}-${call.Caller ?? call.caller ?? 'unknown'}`);
      const location = String(call.Location ?? call.location ?? call.Address ?? call.address ?? 'ER:LC');
      const description = String(call.Description ?? call.description ?? call.Message ?? call.message ?? '112-larm från ER:LC');
      const callerName = String(call.Caller ?? call.caller ?? call.CallerName ?? call.callerName ?? 'Okänd');
      const priority = Number(call.Priority ?? call.priority ?? 3);
      await supabaseAdmin.from('dispatch_calls').upsert({
        caller_id: null,
        source: 'erlc',
        erlc_external_id: externalId,
        caller_name: callerName,
        location,
        description,
        priority: Math.min(5, Math.max(1, priority)),
        status: 'new',
        raw_payload: call,
        updated_at: new Date().toISOString()
      }, { onConflict: 'erlc_external_id' });
    }
  } catch (error) {
    console.error('ER:LC emergency sync failed:', error?.message || error);
  }
}

setInterval(syncEmergencyCalls, pollMs);
syncEmergencyCalls();

app.listen(Number(process.env.PORT || 3000), () => {
  console.log(`MSSRP backend listening on ${process.env.PORT || 3000}`);
  if (!erlc) console.warn('ER:LC_SERVER_KEY is not configured; ER:LC commands/sync are disabled.');
});
