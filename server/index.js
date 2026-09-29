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

app.get('/api/profiles', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user || res.headersSent) return;
  try {
    const userId = String(req.query?.user_id || '').trim();
    const search = String(req.query?.search || '').trim();
    let query = supabaseAdmin.from('profiles').select('*').order('display_name').limit(100);
    if (userId) query = query.eq('id', userId).maybeSingle();
    else if (search) query = query.ilike('display_name', `%${search.replace(/[%_]/g, '')}%`);
    const { data, error } = await query;
    if (error) throw error;
    if (userId) return res.json({ profile: data ? { id:data.id, display_name:data.display_name || data.full_name || 'Användare', avatar_url:data.avatar_url || null, bio:data.bio || '' } : null });
    res.json({ profiles: (data || []).map(p => ({ id:p.id, display_name:p.display_name || p.full_name || 'Användare', avatar_url:p.avatar_url || null, bio:p.bio || '' })) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error?.message || 'Kunde inte läsa profiler.' });
  }
});

app.put('/api/profile', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user || res.headersSent) return;
  const displayName = String(req.body?.display_name || '').trim().slice(0, 60);
  const bio = String(req.body?.bio || '').trim().slice(0, 300);
  const avatarUrl = req.body?.avatar_url ? String(req.body.avatar_url).trim().slice(0, 2000) : null;
  if (!displayName) return res.status(400).json({ error: 'Namn saknas.' });
  try {
    let result = await supabaseAdmin.from('profiles').upsert({
      id: user.id,
      display_name: displayName,
      bio,
      avatar_url: avatarUrl,
      updated_at: new Date().toISOString()
    }, { onConflict: 'id' }).select('*').single();
    if (result.error) {
      // Older profiles schemas may not have bio/updated_at yet.
      result = await supabaseAdmin.from('profiles').upsert({
        id: user.id,
        display_name: displayName,
        avatar_url: avatarUrl
      }, { onConflict: 'id' }).select('*').single();
    }
    if (result.error) throw result.error;
    const data=result.data;
    res.json({ profile: { id:data.id, display_name:data.display_name || displayName, avatar_url:data.avatar_url || avatarUrl, bio:data.bio || bio } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error?.message || 'Kunde inte uppdatera profilen.' });
  }
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



function nextDailyPayday() {
  const now = new Date();
  const next = new Date(now);
  next.setUTCDate(next.getUTCDate() + 1);
  next.setUTCHours(0, 0, 0, 0);
  return next.toISOString();
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

async function ensureBankAccount(userId) {
  let { data: account, error } = await supabaseAdmin
    .from('bank_accounts')
    .select('id,account_number,balance')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!account) {
    const accountNumber = `MSSRP-${String(userId).replace(/-/g,'').slice(0,4).toUpperCase()}-${Math.floor(100000+Math.random()*900000)}`;
    const created = await supabaseAdmin.from('bank_accounts')
      .insert({user_id:userId,account_number:accountNumber,balance:0})
      .select('id,account_number,balance').single();
    if (created.error) throw created.error;
    account = created.data;
  }
  return account;
}

async function payUserDaily(userId, paidBy = 'system') {
  const {data:assignment,error:assignmentError} = await supabaseAdmin
    .from('user_payroll_roles')
    .select('payroll_role_id,last_paid_on,payroll_roles(id,name,monthly_salary)')
    .eq('user_id',userId).maybeSingle();
  if (assignmentError) throw assignmentError;
  const role = assignment?.payroll_roles;
  const amount = Number(role?.monthly_salary || 0);
  if (!assignment || !role || amount <= 0) return {paid:false,reason:'no_role'};
  const today = todayUtc();
  if (assignment.last_paid_on === today) return {paid:false,reason:'already_paid'};

  const account = await ensureBankAccount(userId);
  const newBalance = Number(account.balance || 0) + amount;
  const upd = await supabaseAdmin.from('bank_accounts')
    .update({balance:newBalance,updated_at:new Date().toISOString()})
    .eq('id',account.id);
  if (upd.error) throw upd.error;

  const tx = await supabaseAdmin.from('bank_transactions').insert({
    account_id:account.id,
    amount,
    description:`Daglig lön · ${role.name}`,
    metadata:{paid_by:paidBy,payroll_role:role.name,pay_date:today,type:'daily_payroll'}
  });
  if (tx.error) throw tx.error;

  const mark = await supabaseAdmin.from('user_payroll_roles')
    .update({last_paid_on:today,updated_at:new Date().toISOString()})
    .eq('user_id',userId).is('last_paid_on', assignment.last_paid_on);
  if (mark.error) throw mark.error;
  return {paid:true,amount,balance:newBalance,role:role.name};
}

async function runDailyPayroll() {
  try {
    const {data:users,error} = await supabaseAdmin.from('user_payroll_roles').select('user_id');
    if (error) throw error;
    for (const row of users || []) {
      try { await payUserDaily(row.user_id, 'system'); }
      catch (error) { console.error(`Daily payroll failed for ${row.user_id}:`, error); }
    }
  } catch (error) {
    console.error('Daily payroll scan failed:', error);
  }
}

app.get('/api/bank/account', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user || res.headersSent) return;
  try {
    const { data: profile } = await supabaseAdmin.from('profiles').select('display_name').eq('id', user.id).maybeSingle();
    const { data: payroll } = await supabaseAdmin.from('user_payroll_roles').select('payroll_role_id, payroll_roles(id,name,monthly_salary,description)').eq('user_id', user.id).maybeSingle();
    let { data: account, error: accountError } = await supabaseAdmin.from('bank_accounts').select('id,account_number,balance').eq('user_id', user.id).maybeSingle();
    if (accountError) throw accountError;
    if (!account) {
      const accountNumber = `MSSRP-${String(user.id).replace(/-/g,'').slice(0,4).toUpperCase()}-${Math.floor(100000+Math.random()*900000)}`;
      const created = await supabaseAdmin.from('bank_accounts').insert({user_id:user.id,account_number:accountNumber,balance:0}).select('id,account_number,balance').single();
      if (created.error) throw created.error;
      account = created.data;
    }
    const { data: transactions, error: txError } = await supabaseAdmin.from('bank_transactions').select('id,amount,description,created_at').eq('account_id', account.id).order('created_at',{ascending:false}).limit(25);
    if (txError) throw txError;
    const pr = payroll?.payroll_roles || null;
    res.json({profile, account, payroll:{role_name:pr?.name || null, monthly_salary:Number(pr?.monthly_salary || 0), next_payday:nextDailyPayday()}, transactions:transactions||[]});
  } catch (error) { console.error(error); res.status(500).json({error:error?.message||'Kunde inte läsa bankkontot.'}); }
});

app.get('/api/admin/payroll', async (req, res) => {
  const user = await requireUser(req, res, 'admin');
  if (!user || res.headersSent) return;
  try {
    const [{data:roles,error:roleError},{data:users,error:userError}] = await Promise.all([
      supabaseAdmin.from('payroll_roles').select('id,name,description,monthly_salary,sort_order').order('sort_order'),
      supabaseAdmin.from('profiles').select('id,display_name,user_payroll_roles(payroll_role_id,payroll_roles(id,name,monthly_salary))').order('display_name')
    ]);
    if (roleError) throw roleError; if (userError) throw userError;
    const mapped=(users||[]).map(u=>{const pr=u.user_payroll_roles?.[0]?.payroll_roles;return {id:u.id,display_name:u.display_name,payroll_role_id:pr?.id||null,payroll_role_name:pr?.name||null,monthly_salary:Number(pr?.monthly_salary||0)};});
    res.json({roles:roles||[],users:mapped});
  } catch(error){console.error(error);res.status(500).json({error:error?.message||'Kunde inte läsa payroll.'});}
});

app.put('/api/admin/payroll/roles/:id', async (req,res)=>{
  const user=await requireUser(req,res,'admin'); if(!user||res.headersSent)return;
  const salary=Number(req.body?.monthly_salary); if(!Number.isFinite(salary)||salary<0||salary>10000000)return res.status(400).json({error:'Ogiltig månadslön.'});
  const {data,error}=await supabaseAdmin.from('payroll_roles').update({monthly_salary:Math.round(salary),updated_at:new Date().toISOString()}).eq('id',req.params.id).select('id,name,monthly_salary').single();
  if(error)return res.status(400).json({error:error.message}); res.json({ok:true,role:data});
});

app.post('/api/admin/payroll/assign', async (req,res)=>{
  const user=await requireUser(req,res,'admin'); if(!user||res.headersSent)return;
  const userId=String(req.body?.user_id||''); const roleId=String(req.body?.payroll_role_id||'');
  if(!userId||!roleId)return res.status(400).json({error:'Användare eller löneklass saknas.'});
  const {error}=await supabaseAdmin.from('user_payroll_roles').upsert({user_id:userId,payroll_role_id:roleId,updated_at:new Date().toISOString()},{onConflict:'user_id'});
  if(error)return res.status(400).json({error:error.message}); res.json({ok:true});
});

app.post('/api/admin/payroll/pay', async (req,res)=>{
  const admin=await requireUser(req,res,'admin'); if(!admin||res.headersSent)return;
  const userId=String(req.body?.user_id||''); if(!userId)return res.status(400).json({error:'Användare saknas.'});
  try {
    const result = await payUserDaily(userId, admin.id);
    if (!result.paid && result.reason === 'already_paid') return res.status(409).json({error:'Lönen är redan utbetald idag.'});
    if (!result.paid) return res.status(400).json({error:'Användaren har ingen aktiv löneklass.'});
    res.json({ok:true,...result});
  } catch(error){console.error(error);res.status(500).json({error:error?.message||'Löneutbetalningen misslyckades.'});}
});


app.listen(Number(process.env.PORT || 3000), async () => {
  console.log(`MSSRP backend listening on ${process.env.PORT || 3000}`);
  await runDailyPayroll();
  setInterval(runDailyPayroll, 60 * 60 * 1000);
  if (!erlc) console.warn('ER:LC_SERVER_KEY is not configured; ER:LC commands/sync are disabled.');
});
