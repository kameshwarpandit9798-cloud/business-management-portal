const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, randomBytes, scryptSync, timingSafeEqual } = require('node:crypto');
const { PortalDatabase } = require('./portal-database');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DB_FILE = process.env.PORTAL_DB_FILE ? path.resolve(process.env.PORTAL_DB_FILE) : path.join(ROOT, 'company-portal.sqlite');
const LEGACY_DATA_FILE = process.env.PORTAL_DATA_FILE ? path.resolve(process.env.PORTAL_DATA_FILE) : path.join(ROOT, 'company-portal.json');
const database = new PortalDatabase(DB_FILE);
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const SESSION_TTL = 8 * 60 * 60 * 1000;
const sessions = new Map();
const loginAttempts = new Map();
const chatStreams = new Set();

function passwordRecord(password) {
  const salt = randomBytes(16).toString('hex');
  return { passwordSalt: salt, passwordHash: scryptSync(password, salt, 64).toString('hex') };
}
function makeUser(id, name, email, title, password, memberships) {
  return { id, name, email, title, active: true, ...passwordRecord(password), memberships };
}
function seedData() {
  const demoCredentials = [
    process.env.DEMO_ADMIN_EMAIL,
    process.env.DEMO_ADMIN_PASSWORD,
    process.env.DEMO_MEMBER_EMAIL,
    process.env.DEMO_MEMBER_PASSWORD
  ];
  if (demoCredentials.some(value => !value)) return emptyData();
  const [adminEmail, adminPassword, memberEmail, memberPassword] = demoCredentials;
  const users = [
    makeUser('user-jordan', 'Jordan Davis', adminEmail, 'Portal administrator', adminPassword, [
      { companyId: 'company-forma', role: 'ADMIN', teamIds: ['team-design', 'team-operations'] },
      { companyId: 'company-orbit', role: 'ADMIN', teamIds: ['team-orbit'] }
    ]),
    makeUser('user-maya', 'Maya Chen', memberEmail, 'Design lead', memberPassword, [
      { companyId: 'company-forma', role: 'MEMBER', teamIds: ['team-design', 'team-operations'] }
    ]),
    makeUser('user-alex', 'Alex Rivera', 'alex@studioforma.local', 'Product designer', randomBytes(32).toString('base64url'), [
      { companyId: 'company-forma', role: 'MEMBER', teamIds: ['team-design'] },
      { companyId: 'company-orbit', role: 'MEMBER', teamIds: ['team-orbit'] }
    ]),
    makeUser('user-sam', 'Sam Patel', 'sam@studioforma.local', 'Operations coordinator', randomBytes(32).toString('base64url'), [
      { companyId: 'company-forma', role: 'MEMBER', teamIds: ['team-operations'] }
    ])
  ];
  return {
    companies: [
      { id: 'company-forma', name: 'Studio Forma', industry: 'Design & retail', accent: '#88f0c3' },
      { id: 'company-orbit', name: 'Orbit Collective', industry: 'Product studio', accent: '#aa9cff' }
    ],
    users,
    teams: [
      { id: 'team-design', companyId: 'company-forma', name: 'Design studio', description: 'Brand, space, and product design.', memberIds: ['user-maya', 'user-alex'] },
      { id: 'team-operations', companyId: 'company-forma', name: 'Operations', description: 'The systems that keep good work moving.', memberIds: ['user-jordan', 'user-maya', 'user-sam'] },
      { id: 'team-orbit', companyId: 'company-orbit', name: 'Launch team', description: 'From first sketch to first customer.', memberIds: ['user-jordan', 'user-alex'] }
    ],
    announcements: [
      { id: 'announcement-1', companyId: 'company-forma', title: 'Welcome to the new studio portal', body: 'One place for company updates, team projects, and the small details that help us do our best work.', authorId: 'user-jordan', createdAt: '2026-10-14T08:30:00.000Z', pinned: true },
      { id: 'announcement-2', companyId: 'company-forma', title: 'Friday studio lunch', body: 'We are gathering at the long table this Friday at 12:30. Add any dietary notes to the team calendar.', authorId: 'user-jordan', createdAt: '2026-10-13T12:00:00.000Z', pinned: false },
      { id: 'announcement-3', companyId: 'company-orbit', title: 'October planning is open', body: 'Share your team priorities and proposed milestones for the next release cycle.', authorId: 'user-jordan', createdAt: '2026-10-15T09:00:00.000Z', pinned: true }
    ],
    projects: [
      { id: 'project-1', companyId: 'company-forma', teamId: 'team-design', name: 'A softer storefront', description: 'Refresh the online shop so every product feels at home.', status: 'IN_PROGRESS', dueDate: '2026-11-04', ownerId: 'user-maya', createdAt: '2026-10-09T10:00:00.000Z' },
      { id: 'project-2', companyId: 'company-forma', teamId: 'team-design', name: 'Autumn collection', description: 'Photography, packaging, and launch assets for the new collection.', status: 'PLANNING', dueDate: '2026-11-18', ownerId: 'user-alex', createdAt: '2026-10-12T11:00:00.000Z' },
      { id: 'project-3', companyId: 'company-forma', teamId: 'team-operations', name: 'A smoother handoff', description: 'Document the path from signed brief to delivered work.', status: 'IN_PROGRESS', dueDate: '2026-10-28', ownerId: 'user-sam', createdAt: '2026-10-10T13:00:00.000Z' },
      { id: 'project-4', companyId: 'company-orbit', teamId: 'team-orbit', name: 'Orbit launch plan', description: 'Align launch milestones, owners, and early customer feedback.', status: 'PLANNING', dueDate: '2026-11-21', ownerId: 'user-alex', createdAt: '2026-10-15T10:00:00.000Z' }
    ],
    tasks: [
      { id: 'task-1', companyId: 'company-forma', projectId: 'project-1', teamId: 'team-design', title: 'Finalize storefront wireframes', description: 'Review the mobile and desktop shopping flows with the team.', ownerId: 'user-maya', dueDate: '2026-10-21', priority: 'HIGH', status: 'IN_PROGRESS', createdBy: 'user-jordan', createdAt: '2026-10-14T09:00:00.000Z', updatedAt: '2026-10-15T09:00:00.000Z' },
      { id: 'task-2', companyId: 'company-forma', projectId: 'project-2', teamId: 'team-design', title: 'Book collection photography', description: 'Confirm studio availability and product shot list.', ownerId: 'user-alex', dueDate: '2026-10-23', priority: 'NORMAL', status: 'TODO', createdBy: 'user-jordan', createdAt: '2026-10-15T08:30:00.000Z', updatedAt: '2026-10-15T08:30:00.000Z' },
      { id: 'task-3', companyId: 'company-forma', projectId: 'project-3', teamId: 'team-operations', title: 'Map the client handoff steps', description: 'Capture owners, inputs, and approval points for each stage.', ownerId: 'user-sam', dueDate: '2026-10-20', priority: 'URGENT', status: 'TODO', createdBy: 'user-jordan', createdAt: '2026-10-15T10:00:00.000Z', updatedAt: '2026-10-15T10:00:00.000Z' },
      { id: 'task-4', companyId: 'company-orbit', projectId: 'project-4', teamId: 'team-orbit', title: 'Collect launch partner feedback', description: 'Share the launch outline and capture partner concerns.', ownerId: 'user-alex', dueDate: '2026-10-27', priority: 'HIGH', status: 'TODO', createdBy: 'user-jordan', createdAt: '2026-10-15T11:00:00.000Z', updatedAt: '2026-10-15T11:00:00.000Z' }
    ],
    chatMessages: [],
    featureRecords: []
  };
}
function emptyData() {
  return { companies: [], users: [], teams: [], announcements: [], projects: [], tasks: [], chatMessages: [], featureRecords: [] };
}
function loadData() {
  let saved = database.load();
  if (!saved) {
    try { saved = JSON.parse(fs.readFileSync(LEGACY_DATA_FILE, 'utf8')); }
    catch { saved = process.env.DEMO_MODE === 'true' && process.env.VERCEL !== '1' ? seedData() : emptyData(); }
  }
  const fallback = process.env.DEMO_MODE === 'true' && process.env.VERCEL !== '1' ? seedData() : emptyData();
  for (const key of ['companies', 'users', 'teams', 'announcements', 'projects', 'tasks', 'chatMessages', 'featureRecords']) if (!Array.isArray(saved[key])) saved[key] = fallback[key];
  saved.projects = saved.projects.map(project => ({ health: 'ON_TRACK', nextStep: '', blocker: '', updatedAt: project.createdAt || now(), ...project }));
  saved.tasks = saved.tasks.map(task => ({ priority: 'NORMAL', status: 'TODO', description: '', updatedAt: task.createdAt || now(), ...task }));
  database.save(saved);
  return saved;
}
let data = loadData();
function save() { database.save(data); }
function saveChatMessage(message) { database.insertChatMessage(message); }
function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; if (raw.length > 1_000_000) reject(new Error('Request is too large.')); });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('Request body must be valid JSON.')); } });
  });
}
function cookieValue(req, key) {
  const cookies = (req.headers.cookie || '').split(';').map(value => value.trim());
  const entry = cookies.find(value => value.startsWith(`${key}=`));
  return entry ? decodeURIComponent(entry.slice(key.length + 1)) : null;
}
function currentContext(req) {
  const token = cookieValue(req, 'portal_session');
  const session = token && sessions.get(token);
  if (!session || session.expiresAt < Date.now()) { if (token) sessions.delete(token); return null; }
  const user = data.users.find(item => item.id === session.userId && item.active);
  if (!user) { sessions.delete(token); return null; }
  const membership = session.companyId && user.memberships.find(item => item.companyId === session.companyId);
  const company = membership && data.companies.find(item => item.id === membership.companyId);
  return { token, session, user, membership, company };
}
function publicUser(user, companyId) {
  const membership = user.memberships.find(item => item.companyId === companyId);
  return { id: user.id, name: user.name, email: user.email, title: user.title, active: user.active, role: membership?.role || 'MEMBER', teamIds: membership?.teamIds || [] };
}
function companiesFor(user) {
  return user.memberships.map(membership => {
    const company = data.companies.find(item => item.id === membership.companyId);
    return company ? { ...company, role: membership.role } : null;
  }).filter(Boolean);
}
function authRequired(res) { send(res, 401, { error: 'Sign in to continue.' }); }
function contextRequired(req, res, admin = false) {
  const context = currentContext(req);
  if (!context) { authRequired(res); return null; }
  if (!context.membership || !context.company) { send(res, 409, { error: 'Choose a company first.' }); return null; }
  if (admin && context.membership.role !== 'ADMIN') { send(res, 403, { error: 'Administrator access is required.' }); return null; }
  return context;
}
function teamMembers(team) {
  return team.memberIds.map(id => data.users.find(user => user.id === id && user.active)).filter(Boolean).map(user => publicUser(user, team.companyId));
}
function now() { return new Date().toISOString(); }
function chatContactsFor(user, company, membership) {
  const visibleProjects = data.projects.filter(project => project.companyId === company.id && (membership.role === 'ADMIN' || membership.teamIds.includes(project.teamId)));
  const projectLeadIds = new Set(visibleProjects.map(project => project.ownerId));
  const admins = new Set(data.users.filter(person => person.active && person.memberships.some(item => item.companyId === company.id && item.role === 'ADMIN')).map(person => person.id));
  const existingConversationPeers = data.chatMessages.filter(message => message.companyId === company.id && (message.senderId === user.id || message.recipientId === user.id)).map(message => message.senderId === user.id ? message.recipientId : message.senderId);
  const contactIds = new Set([...admins, ...projectLeadIds, ...existingConversationPeers]);
  contactIds.delete(user.id);
  return data.users.filter(person => person.active && contactIds.has(person.id) && person.memberships.some(item => item.companyId === company.id)).map(person => {
    const personMembership = person.memberships.find(item => item.companyId === company.id);
    const isLead = projectLeadIds.has(person.id);
    return { id: person.id, name: person.name, title: person.title, role: personMembership.role, projectLead: isLead, contactType: personMembership.role === 'ADMIN' && isLead ? 'Administrator · project lead' : personMembership.role === 'ADMIN' ? 'Administrator' : 'Project lead' };
  }).sort((a, b) => (a.role === 'ADMIN' ? 0 : 1) - (b.role === 'ADMIN' ? 0 : 1) || a.name.localeCompare(b.name));
}
function publishChatMessage(message) {
  const payload = `data: ${JSON.stringify(message)}\n\n`;
  for (const client of chatStreams) {
    if (client.companyId === message.companyId && [message.senderId, message.recipientId].includes(client.userId)) {
      try { client.response.write(payload); } catch { chatStreams.delete(client); }
    }
  }
}
function closeChatStreams(token) {
  for (const client of chatStreams) {
    if (client.token !== token) continue;
    chatStreams.delete(client); clearInterval(client.heartbeat); client.response.end();
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const route = url.pathname;
  try {
    if (route === '/api/auth/register' && req.method === 'POST') {
      const body = await readBody(req);
      const name = String(body.name || '').trim();
      const companyName = String(body.companyName || '').trim();
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      if (name.length < 2 || name.length > 80 || companyName.length < 2 || companyName.length > 80 || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8) {
        return send(res, 400, { error: 'Add your name, company, valid email, and a password with at least 8 characters.' });
      }
      if (data.users.some(item => item.email.toLowerCase() === email)) return send(res, 409, { error: 'That email is already registered. Sign in instead.' });
      const company = { id: randomUUID(), name: companyName, industry: 'Your company', accent: '#88f0c3' };
      const user = makeUser(randomUUID(), name, email, 'Company administrator', password, [{ companyId: company.id, role: 'ADMIN', teamIds: [] }]);
      data.companies.push(company); data.users.push(user); save();
      const token = randomBytes(32).toString('base64url'); sessions.set(token, { userId: user.id, companyId: null, expiresAt: Date.now() + SESSION_TTL });
      return send(res, 201, { user: { id: user.id, name: user.name, email: user.email, title: user.title }, companies: companiesFor(user) }, { 'Set-Cookie': `portal_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL / 1000}` });
    }
    if (route === '/api/auth/login' && req.method === 'POST') {
      const body = await readBody(req); const email = String(body.email || '').trim().toLowerCase();
      const key = `${req.socket.remoteAddress}:${email}`; const attempt = loginAttempts.get(key) || { count: 0, until: 0 };
      if (attempt.until > Date.now() && attempt.count >= 8) return send(res, 429, { error: 'Too many attempts. Wait a few minutes and try again.' });
      const user = data.users.find(item => item.email.toLowerCase() === email && item.active);
      const hash = user ? scryptSync(String(body.password || ''), user.passwordSalt, 64) : scryptSync('invalid-password', 'northstar-portal-login', 64);
      const expected = user ? Buffer.from(user.passwordHash, 'hex') : Buffer.alloc(64);
      if (!user || expected.length !== hash.length || !timingSafeEqual(expected, hash)) {
        attempt.count = attempt.until > Date.now() ? attempt.count + 1 : 1; attempt.until = Date.now() + 10 * 60 * 1000; loginAttempts.set(key, attempt);
        return send(res, 401, { error: 'Email or password is incorrect.' });
      }
      loginAttempts.delete(key);
      const token = randomBytes(32).toString('base64url'); sessions.set(token, { userId: user.id, companyId: null, expiresAt: Date.now() + SESSION_TTL });
      return send(res, 200, { user: { id: user.id, name: user.name, email: user.email, title: user.title }, companies: companiesFor(user) }, { 'Set-Cookie': `portal_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL / 1000}` });
    }
    if (route === '/api/auth/logout' && req.method === 'POST') {
      const token = cookieValue(req, 'portal_session'); if (token) sessions.delete(token);
      if (token) closeChatStreams(token);
      return send(res, 200, { ok: true }, { 'Set-Cookie': 'portal_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
    }
    if (route === '/api/auth/session' && req.method === 'GET') {
      const context = currentContext(req); if (!context) return authRequired(res);
      return send(res, 200, { user: { id: context.user.id, name: context.user.name, email: context.user.email, title: context.user.title }, companies: companiesFor(context.user), selectedCompanyId: context.session.companyId, role: context.membership?.role || null });
    }
    if (route === '/api/auth/select-company' && req.method === 'POST') {
      const context = currentContext(req); if (!context) return authRequired(res);
      const body = await readBody(req); const membership = context.user.memberships.find(item => item.companyId === body.companyId);
      if (!membership) return send(res, 403, { error: 'You are not a member of that company.' });
      context.session.companyId = membership.companyId;
      return send(res, 200, { companyId: membership.companyId, role: membership.role });
    }
    if (route.startsWith('/api/')) {
      const adminOnly = ['/api/portal/users', '/api/portal/teams'].includes(route) && req.method !== 'OPTIONS';
      const context = contextRequired(req, res, adminOnly); if (!context) return;
      const { user, company, membership } = context;

      if (route === '/api/portal/chat/stream' && req.method === 'GET') {
        const client = { token: context.token, userId: user.id, companyId: company.id, response: res, heartbeat: null };
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no', 'X-Content-Type-Options': 'nosniff' });
        res.write('retry: 3000\n: connected\n\n');
        chatStreams.add(client);
        client.heartbeat = setInterval(() => {
          const activeSession = sessions.get(client.token);
          if (!activeSession || activeSession.expiresAt < Date.now()) { chatStreams.delete(client); clearInterval(client.heartbeat); client.response.end(); return; }
          try { client.response.write(': keep-alive\n\n'); } catch { chatStreams.delete(client); clearInterval(client.heartbeat); }
        }, 25000);
        client.heartbeat.unref?.();
        res.on('close', () => { chatStreams.delete(client); clearInterval(client.heartbeat); });
        return;
      }
      if (route === '/api/portal/chat/contacts' && req.method === 'GET') return send(res, 200, chatContactsFor(user, company, membership));
      if (route === '/api/portal/chat/messages' && req.method === 'GET') {
        const peerId = String(url.searchParams.get('withUserId') || '');
        const peer = chatContactsFor(user, company, membership).find(person => person.id === peerId);
        if (!peer) return send(res, 403, { error: 'You can only message a company administrator or a project lead in your teams.' });
        const conversation = data.chatMessages.filter(message => message.companyId === company.id && ((message.senderId === user.id && message.recipientId === peerId) || (message.senderId === peerId && message.recipientId === user.id)));
        const beforeId = url.searchParams.get('before');
        const cursorIndex = beforeId ? conversation.findIndex(message => message.id === beforeId) : conversation.length;
        if (beforeId && cursorIndex < 0) return send(res, 400, { error: 'Conversation changed. Reload the chat and try again.' });
        const end = beforeId ? cursorIndex : conversation.length;
        const start = Math.max(0, end - 50);
        return send(res, 200, { messages: conversation.slice(start, end), hasMore: start > 0 });
      }
      if (route === '/api/portal/chat/messages' && req.method === 'POST') {
        const body = await readBody(req); const peerId = String(body.recipientId || ''); const text = String(body.text || '').trim();
        const peer = chatContactsFor(user, company, membership).find(person => person.id === peerId);
        if (!peer) return send(res, 403, { error: 'You can only message a company administrator or a project lead in your teams.' });
        if (!text || text.length > 3000) return send(res, 400, { error: 'Write a message of 1 to 3,000 characters.' });
        const message = { id: randomUUID(), companyId: company.id, senderId: user.id, recipientId: peerId, text, createdAt: now() };
        data.chatMessages.push(message);
        try { saveChatMessage(message); } catch (error) { data.chatMessages.pop(); throw error; }
        publishChatMessage(message);
        return send(res, 201, message);
      }

      if (route === '/api/portal/dashboard' && req.method === 'GET') {
        const visibleTeams = data.teams.filter(team => team.companyId === company.id && (membership.role === 'ADMIN' || membership.teamIds.includes(team.id)));
        const announcements = data.announcements.filter(item => item.companyId === company.id).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt.localeCompare(a.createdAt)).map(item => ({ ...item, author: data.users.find(person => person.id === item.authorId)?.name || 'Company admin' }));
        const projects = data.projects.filter(item => item.companyId === company.id && (membership.role === 'ADMIN' || membership.teamIds.includes(item.teamId))).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
        return send(res, 200, { company, user: publicUser(user, company.id), announcements, teams: visibleTeams.map(team => ({ ...team, members: teamMembers(team) })), projects: projects.map(project => ({ ...project, teamName: data.teams.find(team => team.id === project.teamId)?.name || 'Team', owner: publicUser(data.users.find(item => item.id === project.ownerId) || user, company.id) })) });
      }
      if (route === '/api/portal/users' && req.method === 'GET') {
        const users = data.users.filter(item => item.active && item.memberships.some(m => m.companyId === company.id)).map(item => publicUser(item, company.id));
        return send(res, 200, users);
      }
      if (route === '/api/portal/users' && req.method === 'POST') {
        const body = await readBody(req); const email = String(body.email || '').trim().toLowerCase();
        const name = String(body.name || '').trim();
        if (name.length < 2 || !email || !/^\S+@\S+\.\S+$/.test(email)) return send(res, 400, { error: 'Add a name and valid business email.' });
        const teamIds = Array.isArray(body.teamIds) ? [...new Set(body.teamIds)] : [];
        if (teamIds.some(id => !data.teams.some(team => team.id === id && team.companyId === company.id))) return send(res, 400, { error: 'Choose teams from this company only.' });
        const existing = data.users.find(item => item.email.toLowerCase() === email);
        if (existing) {
          if (!existing.active) return send(res, 409, { error: 'This account is inactive. Contact your portal administrator.' });
          if (existing.memberships.some(item => item.companyId === company.id)) return send(res, 409, { error: 'This person already belongs to this company.' });
          existing.memberships.push({ companyId: company.id, role: body.role === 'ADMIN' ? 'ADMIN' : 'MEMBER', teamIds });
          for (const id of teamIds) { const team = data.teams.find(item => item.id === id); if (!team.memberIds.includes(existing.id)) team.memberIds.push(existing.id); }
          save(); return send(res, 200, { ...publicUser(existing, company.id), accountLinked: true });
        }
        if (String(body.password || '').length < 8) return send(res, 400, { error: 'New accounts need a password with at least 8 characters.' });
        const created = makeUser(randomUUID(), name.slice(0, 80), email, String(body.title || 'Team member').trim().slice(0, 80), String(body.password), [{ companyId: company.id, role: body.role === 'ADMIN' ? 'ADMIN' : 'MEMBER', teamIds }]);
        data.users.push(created); for (const id of teamIds) data.teams.find(team => team.id === id).memberIds.push(created.id); save();
        return send(res, 201, publicUser(created, company.id));
      }
      if (route === '/api/portal/teams' && req.method === 'GET') {
        return send(res, 200, data.teams.filter(team => team.companyId === company.id).map(team => ({ ...team, members: teamMembers(team) })));
      }
      if (route === '/api/portal/teams' && req.method === 'POST') {
        const body = await readBody(req); const name = String(body.name || '').trim();
        if (!name) return send(res, 400, { error: 'Team name is required.' });
        const memberIds = Array.isArray(body.memberIds) ? [...new Set(body.memberIds)] : [];
        const companyUserIds = new Set(data.users.filter(item => item.active && item.memberships.some(m => m.companyId === company.id)).map(item => item.id));
        if (memberIds.some(id => !companyUserIds.has(id))) return send(res, 400, { error: 'Choose members from this company only.' });
        const team = { id: randomUUID(), companyId: company.id, name: name.slice(0, 80), description: String(body.description || '').trim().slice(0, 240), memberIds };
        data.teams.push(team);
        for (const id of memberIds) { const teamMembership = data.users.find(item => item.id === id).memberships.find(m => m.companyId === company.id); if (!teamMembership.teamIds.includes(team.id)) teamMembership.teamIds.push(team.id); }
        save(); return send(res, 201, { ...team, members: teamMembers(team) });
      }
      if (route === '/api/portal/announcements' && req.method === 'GET') {
        return send(res, 200, data.announcements.filter(item => item.companyId === company.id).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt.localeCompare(a.createdAt)).map(item => ({ ...item, author: data.users.find(person => person.id === item.authorId)?.name || 'Company admin' })));
      }
      if (route === '/api/portal/announcements' && req.method === 'POST') {
        if (membership.role !== 'ADMIN') return send(res, 403, { error: 'Administrator access is required.' });
        const body = await readBody(req); const title = String(body.title || '').trim(); const text = String(body.body || '').trim();
        if (!title || !text) return send(res, 400, { error: 'Add an announcement title and message.' });
        const announcement = { id: randomUUID(), companyId: company.id, title: title.slice(0, 120), body: text.slice(0, 2000), authorId: user.id, createdAt: now(), pinned: Boolean(body.pinned) };
        data.announcements.push(announcement); save(); return send(res, 201, { ...announcement, author: user.name });
      }
      const taskView = task => ({ ...task, projectName: data.projects.find(item => item.id === task.projectId)?.name || 'Project', teamName: data.teams.find(item => item.id === task.teamId)?.name || 'Team', ownerName: data.users.find(item => item.id === task.ownerId)?.name || 'Unassigned' });
      const taskDateValid = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00`));
      if (route === '/api/portal/tasks' && req.method === 'GET') {
        let tasks = data.tasks.filter(item => item.companyId === company.id && (membership.role === 'ADMIN' || membership.teamIds.includes(item.teamId)));
        const assignedTo = url.searchParams.get('assignedTo'); const projectId = url.searchParams.get('projectId');
        if (assignedTo) tasks = tasks.filter(item => item.ownerId === assignedTo);
        if (projectId) tasks = tasks.filter(item => item.projectId === projectId);
        return send(res, 200, tasks.sort((a, b) => a.dueDate.localeCompare(b.dueDate)).map(taskView));
      }
      if (route === '/api/portal/tasks' && req.method === 'POST') {
        const body = await readBody(req); const title = String(body.title || '').trim();
        const project = data.projects.find(item => item.id === body.projectId && item.companyId === company.id);
        if (title.length < 2 || title.length > 120 || !project || !taskDateValid(body.dueDate)) return send(res, 400, { error: 'Add a task title, project, and valid due date.' });
        if (membership.role !== 'ADMIN' && !membership.teamIds.includes(project.teamId)) return send(res, 403, { error: 'You can create tasks for your teams only.' });
        const ownerId = String(body.ownerId || user.id); const owner = data.users.find(item => item.id === ownerId && item.active); const ownerMembership = owner?.memberships.find(item => item.companyId === company.id);
        if (!ownerMembership || (!ownerMembership.teamIds.includes(project.teamId) && owner.id !== user.id)) return send(res, 400, { error: 'Choose an active task owner from this project team.' });
        const task = { id: randomUUID(), companyId: company.id, projectId: project.id, teamId: project.teamId, title, description: String(body.description || '').trim().slice(0, 500), ownerId, dueDate: body.dueDate, priority: ['LOW', 'NORMAL', 'HIGH', 'URGENT'].includes(body.priority) ? body.priority : 'NORMAL', status: 'TODO', createdBy: user.id, createdAt: now(), updatedAt: now() };
        data.tasks.push(task); save(); return send(res, 201, taskView(task));
      }
      const taskMatch = route.match(/^\/api\/portal\/tasks\/([^/]+)$/);
      if (taskMatch && ['PATCH', 'DELETE'].includes(req.method)) {
        const index = data.tasks.findIndex(item => item.id === taskMatch[1] && item.companyId === company.id);
        if (index < 0) return send(res, 404, { error: 'Task not found.' });
        const task = data.tasks[index];
        if (membership.role !== 'ADMIN' && !membership.teamIds.includes(task.teamId)) return send(res, 403, { error: 'You cannot change this team task.' });
        if (req.method === 'DELETE') {
          if (membership.role !== 'ADMIN' && task.createdBy !== user.id) return send(res, 403, { error: 'Only an administrator or the task creator can remove it.' });
          data.tasks.splice(index, 1); save(); return send(res, 200, { deleted: task.id });
        }
        const body = await readBody(req);
        if (body.status !== undefined && !['TODO', 'IN_PROGRESS', 'DONE'].includes(body.status)) return send(res, 400, { error: 'Choose a valid task status.' });
        if (body.priority !== undefined && !['LOW', 'NORMAL', 'HIGH', 'URGENT'].includes(body.priority)) return send(res, 400, { error: 'Choose a valid task priority.' });
        if (body.dueDate !== undefined && !taskDateValid(body.dueDate)) return send(res, 400, { error: 'Choose a valid due date.' });
        if (body.ownerId !== undefined) { const owner = data.users.find(item => item.id === String(body.ownerId) && item.active); const ownerMembership = owner?.memberships.find(item => item.companyId === company.id); if (!ownerMembership || (!ownerMembership.teamIds.includes(task.teamId) && owner.id !== user.id)) return send(res, 400, { error: 'Choose an active task owner from this project team.' }); task.ownerId = owner.id; }
        if (![body.status, body.priority, body.dueDate, body.ownerId].some(value => value !== undefined)) return send(res, 400, { error: 'Add a task update before saving.' });
        if (body.status !== undefined) task.status = body.status;
        if (body.priority !== undefined) task.priority = body.priority;
        if (body.dueDate !== undefined) task.dueDate = body.dueDate;
        task.updatedAt = now(); save(); return send(res, 200, taskView(task));
      }
      const announcementMatch = route.match(/^\/api\/portal\/announcements\/([^/]+)$/);
      if (announcementMatch && req.method === 'DELETE') {
        if (membership.role !== 'ADMIN') return send(res, 403, { error: 'Administrator access is required.' });
        const index = data.announcements.findIndex(item => item.id === announcementMatch[1] && item.companyId === company.id);
        if (index < 0) return send(res, 404, { error: 'Announcement not found.' });
        const [removed] = data.announcements.splice(index, 1); save(); return send(res, 200, { deleted: removed.id });
      }
      if (route === '/api/portal/projects' && req.method === 'GET') {
        const teamId = url.searchParams.get('teamId');
        const projects = data.projects.filter(item => item.companyId === company.id && (!teamId || item.teamId === teamId) && (membership.role === 'ADMIN' || membership.teamIds.includes(item.teamId)));
        return send(res, 200, projects.sort((a, b) => a.dueDate.localeCompare(b.dueDate)).map(project => ({ ...project, teamName: data.teams.find(team => team.id === project.teamId)?.name || 'Team', owner: data.users.find(person => person.id === project.ownerId)?.name || 'Team member' })));
      }
      if (route === '/api/portal/projects' && req.method === 'POST') {
        const body = await readBody(req); const name = String(body.name || '').trim(); const team = data.teams.find(item => item.id === body.teamId && item.companyId === company.id);
        if (!name || !team || !body.dueDate) return send(res, 400, { error: 'Add a project name, due date, and valid team.' });
        if (membership.role !== 'ADMIN' && !membership.teamIds.includes(team.id)) return send(res, 403, { error: 'You can create projects for your teams only.' });
        const ownerId = String(body.ownerId || user.id); const owner = data.users.find(item => item.id === ownerId && item.active); const ownerMembership = owner?.memberships.find(item => item.companyId === company.id);
        if (!ownerMembership || (!ownerMembership.teamIds.includes(team.id) && owner.id !== user.id)) return send(res, 400, { error: 'Choose an active owner from this project team.' });
        const project = { id: randomUUID(), companyId: company.id, teamId: team.id, name: name.slice(0, 100), description: String(body.description || '').trim().slice(0, 500), status: ['PLANNING', 'IN_PROGRESS', 'COMPLETE'].includes(body.status) ? body.status : 'PLANNING', health: ['ON_TRACK', 'AT_RISK', 'BLOCKED'].includes(body.health) ? body.health : 'ON_TRACK', nextStep: String(body.nextStep || '').trim().slice(0, 240), blocker: String(body.blocker || '').trim().slice(0, 240), dueDate: body.dueDate, ownerId, createdAt: now(), updatedAt: now() };
        data.projects.push(project); save(); return send(res, 201, { ...project, teamName: team.name, owner: user.name });
      }
      const projectMatch = route.match(/^\/api\/portal\/projects\/([^/]+)$/);
      if (projectMatch && req.method === 'PATCH') {
        const project = data.projects.find(item => item.id === projectMatch[1] && item.companyId === company.id);
        if (!project) return send(res, 404, { error: 'Project not found.' });
        if (membership.role !== 'ADMIN' && !membership.teamIds.includes(project.teamId)) return send(res, 403, { error: 'You cannot update this project.' });
        const body = await readBody(req);
        if (body.status !== undefined && !['PLANNING', 'IN_PROGRESS', 'COMPLETE'].includes(body.status)) return send(res, 400, { error: 'Choose a valid project status.' });
        if (body.health !== undefined && !['ON_TRACK', 'AT_RISK', 'BLOCKED'].includes(body.health)) return send(res, 400, { error: 'Choose a valid project health.' });
        if (body.nextStep !== undefined && String(body.nextStep).length > 240) return send(res, 400, { error: 'Next step must be 240 characters or fewer.' });
        if (body.blocker !== undefined && String(body.blocker).length > 240) return send(res, 400, { error: 'Blocker details must be 240 characters or fewer.' });
        if (body.ownerId !== undefined) {
          const owner = data.users.find(item => item.id === String(body.ownerId) && item.active);
          const ownerMembership = owner?.memberships.find(item => item.companyId === company.id);
          if (!ownerMembership || (!ownerMembership.teamIds.includes(project.teamId) && owner.id !== user.id)) return send(res, 400, { error: 'Choose an active owner from this project team.' });
          project.ownerId = owner.id;
        }
        if (!['status', 'health', 'nextStep', 'blocker', 'ownerId'].some(key => body[key] !== undefined)) return send(res, 400, { error: 'Add a project update before saving.' });
        if (body.status !== undefined) project.status = body.status;
        if (body.health !== undefined) project.health = body.health;
        if (body.nextStep !== undefined) project.nextStep = String(body.nextStep).trim();
        if (body.blocker !== undefined) project.blocker = String(body.blocker).trim();
        project.updatedAt = now(); save(); return send(res, 200, { ...project, teamName: data.teams.find(team => team.id === project.teamId)?.name || 'Team' });
      }
      return send(res, 404, { error: 'Portal endpoint not found.' });
    }

    if (req.method === 'GET') {
      const requested = route === '/' ? 'portal.html' : decodeURIComponent(route.slice(1));
      const file = path.resolve(PUBLIC, requested);
      if (!file.startsWith(`${PUBLIC}${path.sep}`)) { res.writeHead(403); return res.end('Forbidden.'); }
      const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('Not found.'); }
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
      return fs.createReadStream(file).pipe(res);
    }
    return send(res, 404, { error: 'Not found.' });
  } catch (error) {
    return send(res, 500, { error: error.message || 'Server error.' });
  }
});

server.on('clientError', (_error, socket) => socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'));
server.listen(PORT, HOST, () => console.log(`Company Portal running at http://localhost:${PORT}`));
