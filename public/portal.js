const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const initials = value => String(value || '?').trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
let portal = { user: null, companies: [], selectedCompanyId: null, role: null, dashboard: null, users: [], teams: [], projects: [], tasks: [], chatContacts: [], activeChatUserId: null, chatMessages: [], chatHasOlder: false, chatUnread: {}, chatStream: null, chatStreamCompanyId: null, projectTeam: 'all', projectHealthFilter: 'all', taskFilter: 'OPEN' };
let toastTimer;

async function api(route, options = {}) {
  const response = await fetch(route, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  const payload = response.status === 204 ? {} : await response.json();
  if (!response.ok) { if (response.status === 401 && !route.includes('/auth/login')) showLogin(); throw new Error(payload.error || 'The request could not be completed.'); }
  return payload;
}
function toast(message) {
  const node = $('#portalToast'); node.textContent = message; node.classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => node.classList.remove('visible'), 3000);
}
function showLogin(message = '') {
  disconnectChatStream();
  portal.user = null; $('#loginView').classList.remove('hidden'); $('#companyView').classList.add('hidden'); $('#portalShell').classList.add('hidden');
  $('#loginMessage').textContent = message;
}
function showCompanyChoice() { $('#loginView').classList.add('hidden'); $('#portalShell').classList.add('hidden'); $('#companyView').classList.remove('hidden'); }
function showShell() { $('#loginView').classList.add('hidden'); $('#companyView').classList.add('hidden'); $('#portalShell').classList.remove('hidden'); }
function formatDate(value, options = { month: 'short', day: 'numeric', year: 'numeric' }) {
  if (!value) return 'No date'; const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, options);
}
function selectedCompany() { return portal.companies.find(company => company.id === portal.selectedCompanyId); }
function setAuthMode(mode) {
  const signup = mode === 'signup';
  $('#loginForm').classList.toggle('hidden', signup);
  $('#signupForm').classList.toggle('hidden', !signup);
  $('#authSecurity').classList.toggle('hidden', signup);
  $$('.auth-mode-tab').forEach(tab => { const active = tab.dataset.authMode === mode; tab.classList.toggle('active', active); tab.setAttribute('aria-selected', String(active)); });
  $('.auth-form-wrap h2').textContent = signup ? 'Create your workspace' : 'Welcome back';
  $('.auth-form-wrap .form-intro').textContent = signup ? 'Start a company portal and invite your team when you are ready.' : 'Sign in with your business credentials to continue.';
  $('#loginMessage').textContent = ''; $('#signupMessage').textContent = '';
}

async function bootstrap() {
  try {
    const session = await api('/api/auth/session');
    portal.user = session.user; portal.companies = session.companies; portal.selectedCompanyId = session.selectedCompanyId; portal.role = session.role;
    if (portal.selectedCompanyId) await enterCompany(); else renderCompanyChoice();
  } catch { showLogin(); }
}
function renderCompanyChoice() {
  showCompanyChoice();
  $('#companyCards').innerHTML = portal.companies.map((company, index) => `<button type="button" class="company-card" style="--company-accent:${escapeHTML(company.accent || '#88f0c3')}" data-company="${escapeHTML(company.id)}"><span class="role-tag">${escapeHTML(company.role)}</span><span class="company-glyph">${index % 2 ? '◈' : '✳'}</span><strong>${escapeHTML(company.name)}</strong><small>${escapeHTML(company.industry)}</small><span class="company-arrow">↗</span></button>`).join('') || '<p class="empty-state">Your account is not connected to a company yet. Ask an administrator for access.</p>';
  $$('.company-card').forEach(card => card.addEventListener('click', () => selectCompany(card.dataset.company)));
}
async function selectCompany(companyId) {
  try { await api('/api/auth/select-company', { method: 'POST', body: JSON.stringify({ companyId }) }); portal.selectedCompanyId = companyId; portal.projectTeam = 'all'; portal.activeChatUserId = null; portal.chatMessages = []; portal.chatUnread = {}; await enterCompany(); }
  catch (error) { toast(error.message); }
}
async function enterCompany() {
  try {
    const session = await api('/api/auth/session');
    portal.user = session.user; portal.companies = session.companies; portal.selectedCompanyId = session.selectedCompanyId; portal.role = session.role;
    if (!portal.selectedCompanyId) return renderCompanyChoice();
    showShell(); renderIdentity(); await loadWorkspace(); navigate('home');
  } catch (error) { showLogin(error.message); }
}
function renderIdentity() {
  const company = selectedCompany(); if (!company) return;
  $('#currentUser').textContent = portal.user.name; $('#userRole').textContent = portal.role;
  $('#userAvatar').textContent = initials(portal.user.name); $('#companyIndustry').textContent = company.industry.toUpperCase();
  $('#footerCompany').textContent = company.name;
  $$('[data-company-name]').forEach(node => node.textContent = company.name);
  $('#portalCompanySelect').innerHTML = portal.companies.map(item => `<option value="${escapeHTML(item.id)}" ${item.id === company.id ? 'selected' : ''}>${escapeHTML(item.name)}</option>`).join('');
  $$('.admin-nav').forEach(node => node.classList.toggle('hidden', portal.role !== 'ADMIN'));
  $('#createAnnouncement').classList.toggle('hidden', portal.role !== 'ADMIN');
  $('#createUser').classList.toggle('hidden', portal.role !== 'ADMIN');
  $('#createTeam').classList.toggle('hidden', portal.role !== 'ADMIN');
}
async function loadWorkspace() {
  portal.dashboard = await api('/api/portal/dashboard');
  if (portal.role === 'ADMIN') {
    [portal.users, portal.teams] = await Promise.all([api('/api/portal/users'), api('/api/portal/teams')]);
    $('#navUserCount').textContent = portal.users.length;
  } else {
    portal.teams = portal.dashboard.teams; portal.users = [...new Map(portal.teams.flatMap(team => team.members).map(user => [user.id, user])).values()];
  }
  portal.projects = await api('/api/portal/projects');
  portal.tasks = await api('/api/portal/tasks');
  await loadChatContacts();
  connectChatStream();
  renderWorkspace();
}
function renderWorkspace() { renderHome(); if (portal.role === 'ADMIN') { renderUsers(); renderTeams(); } renderProjects(); renderTasks(); }
function renderHome() {
  const dashboard = portal.dashboard; const company = selectedCompany();
  const firstName = portal.user.name.split(/\s+/)[0];
  $('#greetingName').textContent = firstName;
  $('#homeSubtitle').textContent = portal.role === 'ADMIN' ? `Here’s what’s happening across ${company.name}.` : `Here’s what’s happening across your teams at ${company.name}.`;
  $('#todayLabel').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).toUpperCase().replace(',', ' ·');
  $('#announcementCount').textContent = dashboard.announcements.length;
  const today = new Date().toISOString().slice(0, 10);
  const attentionProjects = dashboard.projects.filter(project => {
    const updated = Date.parse(project.updatedAt || project.createdAt);
    const stale = Number.isFinite(updated) && Date.now() - updated > 7 * 24 * 60 * 60 * 1000;
    return project.status !== 'COMPLETE' && ((project.health || 'ON_TRACK') !== 'ON_TRACK' || project.dueDate < today || stale);
  });
  $('#homeAttentionCount').textContent = attentionProjects.length;
  $('#homeAttentionCopy').textContent = attentionProjects.length ? `${attentionProjects.length} project${attentionProjects.length === 1 ? '' : 's'} need a check-in` : 'All open work looks on track';
  $('#homeDeliveryAlert').classList.toggle('clear', attentionProjects.length === 0);
  $('#announcementList').innerHTML = dashboard.announcements.length ? dashboard.announcements.map(item => `<article class="announcement-card ${item.pinned ? 'pinned' : ''}"><div class="announcement-topline"><span class="announcement-label">${item.pinned ? '✦ PINNED UPDATE' : 'COMPANY UPDATE'}</span>${item.pinned ? '<span class="pin-label">◈ For everyone</span>' : ''}</div><h3>${escapeHTML(item.title)}</h3><p>${escapeHTML(item.body)}</p><div class="announcement-meta"><span class="meta-avatar">${escapeHTML(initials(item.author))}</span><span>${escapeHTML(item.author)} · ${formatDate(item.createdAt, { month: 'short', day: 'numeric' })}</span>${portal.role === 'ADMIN' ? `<button type="button" class="delete-announcement" data-id="${escapeHTML(item.id)}" title="Remove announcement" aria-label="Remove announcement">×</button>` : ''}</div></article>`).join('') : '<div class="empty-state">No company updates yet. This is a good place to share the first one.</div>';
  $('#homeTeams').innerHTML = dashboard.teams.length ? dashboard.teams.slice(0, 4).map(team => `<div class="home-team-row"><span class="team-monogram">${escapeHTML(initials(team.name))}</span><span class="home-team-copy"><strong>${escapeHTML(team.name)}</strong><small>${team.members.length} ${team.members.length === 1 ? 'person' : 'people'} · ${escapeHTML(team.description || 'Shared team space')}</small></span><span class="member-stack">${team.members.slice(0, 3).map(member => `<span class="stack-avatar" title="${escapeHTML(member.name)}">${escapeHTML(initials(member.name))}</span>`).join('')}</span></div>`).join('') : '<div class="empty-state">You are not assigned to a team yet.</div>';
  $('#homeProjects').innerHTML = dashboard.projects.length ? dashboard.projects.slice(0, 4).map(project => `<div class="home-project-row"><i class="project-dot ${project.status === 'IN_PROGRESS' ? 'progress' : project.status === 'COMPLETE' ? 'complete' : ''}"></i><span class="home-project-copy"><strong>${escapeHTML(project.name)}</strong><small>${escapeHTML(project.teamName)} · ${escapeHTML(project.status.replace('_', ' ').toLowerCase())}</small></span><span class="project-date">${formatDate(project.dueDate, { month: 'short', day: 'numeric' })}</span></div>`).join('') : '<div class="empty-state">No projects are underway yet.</div>';
  $$('.delete-announcement').forEach(button => button.addEventListener('click', async () => {
    if (!confirm('Remove this company announcement?')) return;
    try { await api(`/api/portal/announcements/${encodeURIComponent(button.dataset.id)}`, { method: 'DELETE' }); await loadWorkspace(); toast('Announcement removed.'); } catch (error) { toast(error.message); }
  }));
}
function renderUsers(filter = $('#userSearch')?.value || '') {
  const teamsById = new Map(portal.teams.map(team => [team.id, team.name])); const query = filter.trim().toLowerCase();
  const users = portal.users.filter(user => `${user.name} ${user.email} ${user.title}`.toLowerCase().includes(query));
  $('#directoryCount').textContent = `${users.length} ${users.length === 1 ? 'person' : 'people'}`;
  $('#usersRows').innerHTML = users.map(user => `<tr><td><div class="person-cell"><span class="person-badge">${escapeHTML(initials(user.name))}</span><span class="person-copy"><strong>${escapeHTML(user.name)}</strong><small>${escapeHTML(user.email)} · ${escapeHTML(user.title || 'Team member')}</small></span></div></td><td>${user.teamIds.map(id => escapeHTML(teamsById.get(id) || '')).filter(Boolean).join(', ') || '—'}</td><td><span class="access-badge ${user.role === 'ADMIN' ? 'access-admin' : 'access-member'}">${escapeHTML(user.role)}</span></td><td><span class="status-badge status-active">● ACTIVE</span></td></tr>`).join('') || '<tr><td colspan="4" class="empty-state">No people match that search.</td></tr>';
}
function renderTeams() {
  $('#teamsGrid').innerHTML = portal.teams.map(team => `<article class="team-card"><div class="team-card-top"><span class="team-monogram">${escapeHTML(initials(team.name))}</span><span class="team-size">${team.members.length} MEMBERS</span></div><h3>${escapeHTML(team.name)}</h3><p>${escapeHTML(team.description || 'A team working toward shared outcomes.')}</p><div class="team-members">${team.members.map(member => `<span class="member-chip"><span class="person-badge">${escapeHTML(initials(member.name))}</span>${escapeHTML(member.name.split(' ')[0])}</span>`).join('') || '<small class="search-hint">No members yet</small>'}</div></article>`).join('') || '<div class="portal-card empty-state">No teams yet. Create the first team space.</div>';
}
function renderProjects() {
  const teams = portal.dashboard.teams;
  const today = new Date().toISOString().slice(0, 10);
  const overdue = project => project.status !== 'COMPLETE' && project.dueDate < today;
  const stale = project => { const updated = Date.parse(project.updatedAt || project.createdAt); return Number.isFinite(updated) && Date.now() - updated > 7 * 24 * 60 * 60 * 1000; };
  const needsAttention = project => project.status !== 'COMPLETE' && ((project.health || 'ON_TRACK') !== 'ON_TRACK' || overdue(project) || stale(project));
  const atRiskCount = portal.projects.filter(project => needsAttention(project) && project.status !== 'COMPLETE').length;
  const overdueCount = portal.projects.filter(overdue).length;
  const onTrackCount = portal.projects.filter(project => !needsAttention(project) && project.status !== 'COMPLETE').length;
  $('#projectHealthSummary').innerHTML = `<article class="health-metric"><span>NEEDS ATTENTION</span><strong class="metric-risk">${atRiskCount}</strong><small>Risk, overdue, or stale check-in</small></article><article class="health-metric"><span>OVERDUE</span><strong class="metric-overdue">${overdueCount}</strong><small>Past due and still open</small></article><article class="health-metric"><span>ON TRACK</span><strong class="metric-track">${onTrackCount}</strong><small>Open projects with recent updates</small></article>`;
  const filters = [{ id: 'all', name: portal.role === 'ADMIN' ? 'All company projects' : 'All my team projects' }, { id: 'attention', name: `Needs attention · ${atRiskCount}` }, ...teams.map(team => ({ id: team.id, name: team.name }))];
  $('#projectTeamFilters').innerHTML = filters.map(filter => `<button class="filter-pill ${filter.id === 'attention' ? portal.projectHealthFilter === 'attention' ? 'active' : '' : portal.projectHealthFilter === 'all' && portal.projectTeam === filter.id ? 'active' : ''}" data-team-filter="${escapeHTML(filter.id)}">${escapeHTML(filter.name)}</button>`).join('');
  $$('.filter-pill').forEach(button => button.addEventListener('click', () => { if (button.dataset.teamFilter === 'attention') { portal.projectHealthFilter = 'attention'; } else { portal.projectHealthFilter = 'all'; portal.projectTeam = button.dataset.teamFilter; } renderProjects(); }));
  const teamOptions = teams.map(team => `<option value="${escapeHTML(team.id)}">${escapeHTML(team.name)}</option>`).join('');
  $('#projectForm').elements.teamId.innerHTML = teamOptions;
  $('#projectForm').elements.teamId.disabled = !teams.length;
  $('#projectForm').elements.ownerId.innerHTML = projectOwnerOptions($('#projectForm').elements.teamId.value, portal.user.id);
  let projects = portal.projectTeam === 'all' ? portal.projects : portal.projects.filter(project => project.teamId === portal.projectTeam);
  if (portal.projectHealthFilter === 'attention') projects = projects.filter(needsAttention);
  projects = [...projects].sort((a, b) => Number(needsAttention(b)) - Number(needsAttention(a)) || a.dueDate.localeCompare(b.dueDate));
  $('#projectCount').textContent = `${projects.length} ${projects.length === 1 ? 'project' : 'projects'}`;
  $('#projectsGrid').innerHTML = projects.map(project => {
    const health = project.health || 'ON_TRACK'; const overdueNow = overdue(project); const staleNow = stale(project);
    const healthLabel = health === 'BLOCKED' ? 'Blocked' : health === 'AT_RISK' ? 'At risk' : 'On track';
    const healthClass = health.toLowerCase().replace('_', '-');
    return `<article class="project-card ${needsAttention(project) ? 'project-needs-attention' : ''}"><div class="project-card-top"><span class="health-badge health-${healthClass}">${healthLabel}</span>${staleNow ? '<span class="stale-flag">CHECK-IN DUE</span>' : ''}<span class="team-size">${escapeHTML(project.teamName)}</span></div><h3>${escapeHTML(project.name)}</h3><p>${escapeHTML(project.description || 'A new project from the team.')}</p><div class="project-card-footer"><span class="project-due ${overdueNow ? 'due-overdue' : ''}">${overdueNow ? 'OVERDUE · ' : 'DUE · '}${formatDate(project.dueDate, { month: 'short', day: 'numeric', year: 'numeric' })}</span><span class="project-status status-${project.status.toLowerCase()}">${escapeHTML(project.status.replace('_', ' '))}</span></div>${project.blocker ? `<div class="project-blocker"><strong>BLOCKER</strong><span>${escapeHTML(project.blocker)}</span></div>` : ''}<div class="project-next-step"><span>NEXT ACTION</span><strong>${escapeHTML(project.nextStep || 'Add the next concrete action')}</strong><small>Updated ${formatDate(project.updatedAt || project.createdAt, { month: 'short', day: 'numeric' })}</small></div><form class="project-update-form" data-id="${escapeHTML(project.id)}"><label>Owner<select name="ownerId">${projectOwnerOptions(project.teamId, project.ownerId)}</select></label><label>Health<select name="health"><option value="ON_TRACK" ${health === 'ON_TRACK' ? 'selected' : ''}>On track</option><option value="AT_RISK" ${health === 'AT_RISK' ? 'selected' : ''}>At risk</option><option value="BLOCKED" ${health === 'BLOCKED' ? 'selected' : ''}>Blocked</option></select></label><label>Status<select name="status"><option value="PLANNING" ${project.status === 'PLANNING' ? 'selected' : ''}>Planning</option><option value="IN_PROGRESS" ${project.status === 'IN_PROGRESS' ? 'selected' : ''}>In progress</option><option value="COMPLETE" ${project.status === 'COMPLETE' ? 'selected' : ''}>Complete</option></select></label><label class="update-wide">Next action<input name="nextStep" maxlength="240" value="${escapeHTML(project.nextStep || '')}" placeholder="Who will do what next?" /></label><label class="update-wide">Blocker<input name="blocker" maxlength="240" value="${escapeHTML(project.blocker || '')}" placeholder="What is holding this up? Clear when resolved." /></label><button class="portal-button update-project-button" type="submit">Save project update <span>↗</span></button></form></article>`;
  }).join('') || '<div class="portal-card empty-state">No projects need attention in this view. Your team is clear to focus on delivery.</div>';
  $$('.project-update-form').forEach(form => form.addEventListener('submit', async event => {
    event.preventDefault(); const updateForm = event.currentTarget; const values = new FormData(updateForm); const button = updateForm.querySelector('button[type="submit"]'); button.disabled = true;
    try { await api(`/api/portal/projects/${encodeURIComponent(updateForm.dataset.id)}`, { method: 'PATCH', body: JSON.stringify(Object.fromEntries(values)) }); await loadWorkspace(); toast('Project health and next steps saved.'); }
    catch (error) { button.disabled = false; toast(error.message); }
  }));
}
function renderTasks() {
  const today = new Date().toISOString().slice(0, 10);
  const open = portal.tasks.filter(task => task.status !== 'DONE');
  const overdue = open.filter(task => task.dueDate < today);
  const mine = open.filter(task => task.ownerId === portal.user.id);
  const dueSoon = open.filter(task => task.dueDate >= today && task.dueDate <= new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10));
  $('#taskSummary').innerHTML = `<article class="health-metric"><span>OPEN TASKS</span><strong>${open.length}</strong><small>Assigned across visible teams</small></article><article class="health-metric"><span>ASSIGNED TO YOU</span><strong class="metric-track">${mine.length}</strong><small>Personal follow-through</small></article><article class="health-metric"><span>OVERDUE</span><strong class="metric-overdue">${overdue.length}</strong><small>Open tasks past their due date</small></article>`;
  const filters = [['ALL','All'],['OPEN','Open'],['MINE','Mine'],['DUE_SOON','Due soon'],['OVERDUE','Overdue'],['DONE','Done']];
  $('#taskFilters').innerHTML = filters.map(([id,label]) => `<button class="filter-pill ${portal.taskFilter === id ? 'active' : ''}" data-task-filter="${id}">${label}${id === 'OVERDUE' && overdue.length ? ` · ${overdue.length}` : ''}</button>`).join('');
  $$('#taskFilters [data-task-filter]').forEach(button => button.addEventListener('click', () => { portal.taskFilter = button.dataset.taskFilter; renderTasks(); }));
  const view = portal.tasks.filter(task => {
    if (portal.taskFilter === 'ALL') return true;
    if (portal.taskFilter === 'OPEN') return task.status !== 'DONE';
    if (portal.taskFilter === 'MINE') return task.status !== 'DONE' && task.ownerId === portal.user.id;
    if (portal.taskFilter === 'DUE_SOON') return task.status !== 'DONE' && task.dueDate >= today && task.dueDate <= new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    if (portal.taskFilter === 'OVERDUE') return task.status !== 'DONE' && task.dueDate < today;
    return task.status === 'DONE';
  }).sort((a,b) => (a.status === 'DONE') - (b.status === 'DONE') || a.dueDate.localeCompare(b.dueDate));
  $('#taskCount').textContent = `${view.length} ${view.length === 1 ? 'task' : 'tasks'}`;
  $('#tasksGrid').innerHTML = view.map(task => `<article class="task-card ${task.status === 'DONE' ? 'task-complete' : task.dueDate < today ? 'task-overdue' : ''}"><div class="task-card-top"><span class="task-priority priority-${task.priority.toLowerCase()}">${escapeHTML(task.priority)}</span><span class="task-project">${escapeHTML(task.projectName)} · ${escapeHTML(task.teamName)}</span></div><h3>${escapeHTML(task.title)}</h3><p>${escapeHTML(task.description || 'No extra context added.')}</p><div class="task-owner-line"><span class="person-badge">${escapeHTML(initials(task.ownerName))}</span><span>${escapeHTML(task.ownerName)}</span><span class="task-due">${task.dueDate < today && task.status !== 'DONE' ? 'OVERDUE · ' : 'DUE · '}${formatDate(task.dueDate,{month:'short',day:'numeric',year:'numeric'})}</span></div><form class="task-update-form" data-id="${escapeHTML(task.id)}"><label>Owner<select name="ownerId">${projectOwnerOptions(task.teamId, task.ownerId)}</select></label><label>Status<select name="status"><option value="TODO" ${task.status === 'TODO' ? 'selected' : ''}>To do</option><option value="IN_PROGRESS" ${task.status === 'IN_PROGRESS' ? 'selected' : ''}>In progress</option><option value="DONE" ${task.status === 'DONE' ? 'selected' : ''}>Done</option></select></label><label>Priority<select name="priority"><option value="LOW" ${task.priority === 'LOW' ? 'selected' : ''}>Low</option><option value="NORMAL" ${task.priority === 'NORMAL' ? 'selected' : ''}>Normal</option><option value="HIGH" ${task.priority === 'HIGH' ? 'selected' : ''}>High</option><option value="URGENT" ${task.priority === 'URGENT' ? 'selected' : ''}>Urgent</option></select></label><label>Due date<input name="dueDate" type="date" value="${escapeHTML(task.dueDate)}" required /></label><button class="portal-button update-task-button" type="submit">Save update <span>↗</span></button>${portal.role === 'ADMIN' || task.createdBy === portal.user.id ? `<button class="task-delete" type="button" data-delete-task="${escapeHTML(task.id)}">Remove task</button>` : ''}</form></article>`).join('') || '<div class="portal-card empty-state">Nothing in this view. Create a task or choose another filter.</div>';
  $$('.task-update-form').forEach(form => form.addEventListener('submit', async event => {
    event.preventDefault(); const button = form.querySelector('[type="submit"]'); button.disabled = true;
    try { await api(`/api/portal/tasks/${encodeURIComponent(form.dataset.id)}`, { method: 'PATCH', body: JSON.stringify(Object.fromEntries(new FormData(form))) }); await loadWorkspace(); toast('Task updated.'); }
    catch (error) { button.disabled = false; toast(error.message); }
  }));
  $$('[data-delete-task]').forEach(button => button.addEventListener('click', async () => {
    if (!confirm('Remove this task?')) return;
    try { await api(`/api/portal/tasks/${encodeURIComponent(button.dataset.deleteTask)}`, { method: 'DELETE' }); await loadWorkspace(); toast('Task removed.'); } catch (error) { toast(error.message); }
  }));
  const projectSelect = $('#taskForm').elements.projectId;
  projectSelect.innerHTML = portal.projects.map(project => `<option value="${escapeHTML(project.id)}">${escapeHTML(project.name)} · ${escapeHTML(project.teamName)}</option>`).join('');
  $('#taskForm').elements.ownerId.innerHTML = projectOwnerOptions(portal.projects.find(project => project.id === projectSelect.value)?.teamId, portal.user.id);
  $('#createTask').disabled = portal.projects.length === 0;
}
async function loadChatContacts() {
  portal.chatContacts = await api('/api/portal/chat/contacts');
  if (portal.activeChatUserId && !portal.chatContacts.some(contact => contact.id === portal.activeChatUserId)) {
    portal.activeChatUserId = null; portal.chatMessages = [];
  }
  renderChatContacts();
}
function renderChatContacts() {
  const query = ($('#chatContactSearch')?.value || '').trim().toLowerCase();
  const contacts = portal.chatContacts.filter(contact => `${contact.name} ${contact.title} ${contact.contactType}`.toLowerCase().includes(query));
  $('#chatContactCount').textContent = portal.chatContacts.length;
  $('#chatContacts').innerHTML = contacts.map(contact => `<button type="button" class="chat-contact ${portal.activeChatUserId === contact.id ? 'active' : ''}" data-chat-contact="${escapeHTML(contact.id)}"><span class="chat-contact-avatar">${escapeHTML(initials(contact.name))}</span><span class="chat-contact-copy"><strong>${escapeHTML(contact.name)}</strong><small>${escapeHTML(contact.contactType)} · ${escapeHTML(contact.title || 'Team lead')}</small></span>${portal.chatUnread[contact.id] ? `<span class="chat-unread">${portal.chatUnread[contact.id]}</span>` : ''}</button>`).join('') || `<div class="chat-list-empty">${portal.chatContacts.length ? 'No people match your search.' : 'No administrators or project leads are available in this workspace yet.'}</div>`;
  $$('[data-chat-contact]').forEach(button => button.addEventListener('click', () => openChat(button.dataset.chatContact)));
  const unreadCount = Object.values(portal.chatUnread).reduce((total, count) => total + count, 0);
  $('#navChatUnread').textContent = unreadCount > 9 ? '9+' : unreadCount;
  $('#navChatUnread').classList.toggle('hidden', unreadCount === 0);
}
async function openChat(contactId) {
  const contact = portal.chatContacts.find(person => person.id === contactId);
  if (!contact) return;
  portal.activeChatUserId = contactId; portal.chatUnread[contactId] = 0;
  renderChatContacts();
  $('#chatHeader').innerHTML = `<span class="chat-contact-avatar chat-header-avatar">${escapeHTML(initials(contact.name))}</span><div><strong>${escapeHTML(contact.name)}</strong><small>${escapeHTML(contact.contactType)} · Private company chat</small></div><span class="chat-live-label"><i></i> LIVE</span>`;
  $('#chatMessages').innerHTML = '<div class="chat-loading">Loading conversation…</div>';
  $('#chatInput').disabled = false; $('#chatForm').querySelector('button[type="submit"]').disabled = false;
  renderChatContacts();
  try {
    const result = await api(`/api/portal/chat/messages?withUserId=${encodeURIComponent(contactId)}`);
    if (portal.activeChatUserId !== contactId) return;
    portal.chatMessages = result.messages; portal.chatHasOlder = result.hasMore; renderChatMessages(true);
  } catch (error) { $('#chatMessages').innerHTML = `<div class="chat-list-empty">${escapeHTML(error.message)}</div>`; }
}
async function loadOlderChatMessages() {
  if (!portal.activeChatUserId || !portal.chatHasOlder) return;
  const button = $('#loadOlderChat'); if (button) button.disabled = true;
  const contactId = portal.activeChatUserId; const list = $('#chatMessages');
  const anchor = { top: list.scrollTop, height: list.scrollHeight };
  try {
    const result = await api(`/api/portal/chat/messages?withUserId=${encodeURIComponent(contactId)}&before=${encodeURIComponent(portal.chatMessages[0]?.id || '')}`);
    if (portal.activeChatUserId !== contactId) return;
    const known = new Set(portal.chatMessages.map(message => message.id));
    portal.chatMessages = [...result.messages.filter(message => !known.has(message.id)), ...portal.chatMessages];
    portal.chatHasOlder = result.hasMore; renderChatMessages(false, anchor);
  } catch (error) { toast(error.message); if (button) button.disabled = false; }
}
function updateChatJumpButton() {
  const list = $('#chatMessages'); const button = $('#chatJumpLatest');
  if (!list || !button) return;
  button.classList.toggle('hidden', list.scrollHeight - list.clientHeight - list.scrollTop < 100);
}
function renderChatMessages(forceBottom = false, anchor = null) {
  const list = $('#chatMessages');
  const priorTop = list.scrollTop; const wasNearBottom = list.scrollHeight - list.clientHeight - priorTop < 100;
  const messagesHTML = portal.chatMessages.length ? portal.chatMessages.map(message => {
    const own = message.senderId === portal.user.id;
    return `<article class="chat-message ${own ? 'message-outgoing' : 'message-incoming'}"><div class="chat-message-author">${own ? 'You' : escapeHTML(portal.chatContacts.find(contact => contact.id === message.senderId)?.name || 'Company teammate')}</div><div class="chat-message-bubble">${escapeHTML(message.text)}</div><time datetime="${escapeHTML(message.createdAt)}">${new Date(message.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</time></article>`;
  }).join('') : '<div class="chat-empty-state"><span>✳</span><strong>Start the conversation.</strong><small>Send a note, ask for help, or share a project update.</small></div>';
  list.innerHTML = `${portal.chatHasOlder ? '<button id="loadOlderChat" class="chat-load-older" type="button">↑ Load previous messages</button>' : ''}${messagesHTML}`;
  $('#loadOlderChat')?.addEventListener('click', loadOlderChatMessages);
  if (anchor) list.scrollTop = list.scrollHeight - anchor.height + anchor.top;
  else if (forceBottom || wasNearBottom) list.scrollTop = list.scrollHeight;
  else list.scrollTop = priorTop;
  updateChatJumpButton();
}
function receiveChatMessage(message) {
  if (message.companyId !== portal.selectedCompanyId) return;
  const peerId = message.senderId === portal.user.id ? message.recipientId : message.senderId;
  const chatIsOpen = portal.activeChatUserId === peerId && !$('#chatPage').classList.contains('hidden');
  if (chatIsOpen) {
    if (!portal.chatMessages.some(item => item.id === message.id)) portal.chatMessages.push(message);
    renderChatMessages();
  } else if (message.recipientId === portal.user.id) {
    portal.chatUnread[peerId] = (portal.chatUnread[peerId] || 0) + 1;
    if (!portal.chatContacts.some(contact => contact.id === peerId)) loadChatContacts().catch(error => toast(error.message));
  }
  renderChatContacts();
}
function connectChatStream() {
  if (portal.chatStream && portal.chatStreamCompanyId === portal.selectedCompanyId) return;
  disconnectChatStream();
  portal.chatStreamCompanyId = portal.selectedCompanyId;
  portal.chatStream = new EventSource('/api/portal/chat/stream');
  portal.chatStream.onmessage = event => { try { receiveChatMessage(JSON.parse(event.data)); } catch { /* Ignore malformed event data. */ } };
  portal.chatStream.onerror = () => { $('#chatConnectionState')?.classList.add('offline'); };
  portal.chatStream.onopen = () => { $('#chatConnectionState')?.classList.remove('offline'); };
}
function disconnectChatStream() {
  if (portal.chatStream) portal.chatStream.close();
  portal.chatStream = null; portal.chatStreamCompanyId = null;
}
async function loadProjects() {
  try { portal.projects = await api(`/api/portal/projects${portal.projectTeam === 'all' ? '' : `?teamId=${encodeURIComponent(portal.projectTeam)}`}`); renderProjects(); }
  catch (error) { toast(error.message); }
}
function navigate(page) {
  if (['users', 'teams'].includes(page) && portal.role !== 'ADMIN') page = 'home';
  $$('.portal-page').forEach(section => section.classList.toggle('hidden', section.id !== `${page}Page`));
  $$('.nav-link').forEach(link => link.classList.toggle('active', link.dataset.page === page));
  if (page === 'projects') loadProjects();
  if (page === 'tasks') renderTasks();
  if (page === 'chat') {
    renderChatContacts();
    if (!portal.activeChatUserId && portal.chatContacts.length) openChat(portal.chatContacts[0].id);
    else if (portal.activeChatUserId) openChat(portal.activeChatUserId);
  }
}
function fillMemberChoices(fieldset, users, selected = []) {
  fieldset.querySelector('.choice-list').innerHTML = users.map(user => `<label class="choice-item"><input type="checkbox" value="${escapeHTML(user.id)}" ${selected.includes(user.id) ? 'checked' : ''}><span>${escapeHTML(user.name)} <small>· ${escapeHTML(user.title || 'Team member')}</small></span></label>`).join('') || '<small class="search-hint">Create a person first.</small>';
}
function fillTeamChoices(fieldset, teams) {
  fieldset.querySelector('.choice-list').innerHTML = teams.map(team => `<label class="choice-item"><input type="checkbox" value="${escapeHTML(team.id)}"><span>${escapeHTML(team.name)}</span></label>`).join('') || '<small class="search-hint">Create a team first.</small>';
}
function projectOwnerOptions(teamId, selectedOwnerId = '') {
  let candidates = portal.users.filter(person => person.teamIds?.includes(teamId));
  if (portal.user && !candidates.some(person => person.id === portal.user.id)) candidates = [...candidates, { id: portal.user.id, name: portal.user.name }];
  return candidates.map(person => `<option value="${escapeHTML(person.id)}" ${person.id === selectedOwnerId ? 'selected' : ''}>${escapeHTML(person.name)}</option>`).join('');
}
function bindForms() {
  $('#announcementForm').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget; const values = new FormData(form);
    try { await api('/api/portal/announcements', { method: 'POST', body: JSON.stringify({ title: values.get('title'), body: values.get('body'), pinned: values.has('pinned') }) }); form.reset(); $('#announcementDialog').close(); await loadWorkspace(); toast('Your announcement is live for the company.'); }
    catch (error) { toast(error.message); }
  });
  $('#userForm').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget; const values = new FormData(form); const teamIds = $$('#userTeamChoices input:checked').map(input => input.value);
    const submit = $('#createUserSubmit'); const idleMarkup = submit.innerHTML;
    submit.disabled = true; submit.textContent = 'Creating account…'; $('#userFormMessage').textContent = '';
    try {
      const result = await api('/api/portal/users', { method: 'POST', body: JSON.stringify({ name: values.get('name'), title: values.get('title'), email: values.get('email'), password: values.get('password'), role: values.get('role'), teamIds }) });
      form.reset(); $('#userDialog').close(); toast(result.accountLinked ? 'Existing account added to this company. They can sign in with their current password.' : 'Business account created.');
      await loadWorkspace();
    } catch (error) {
      if ($('#userDialog').open) $('#userFormMessage').textContent = error.message;
      else toast('Account created, but the directory did not refresh. Reload the page to see the new person.');
    } finally { submit.disabled = false; submit.innerHTML = idleMarkup; }
  });
  $('#teamForm').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget; const values = new FormData(form); const memberIds = $$('#teamMemberChoices input:checked').map(input => input.value);
    try { await api('/api/portal/teams', { method: 'POST', body: JSON.stringify({ name: values.get('name'), description: values.get('description'), memberIds }) }); form.reset(); $('#teamDialog').close(); await loadWorkspace(); toast('Team space created.'); }
    catch (error) { toast(error.message); }
  });
  $('#projectForm').addEventListener('submit', async event => {
    event.preventDefault(); const formElement = event.currentTarget; const values = new FormData(formElement);
    try { await api('/api/portal/projects', { method: 'POST', body: JSON.stringify(Object.fromEntries(values)) }); formElement.reset(); $('#projectDialog').close(); portal.projectTeam = 'all'; portal.projectHealthFilter = 'all'; await loadWorkspace(); navigate('projects'); toast('Project created for your team.'); }
    catch (error) { toast(error.message); }
  });
  $('#taskForm').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget; const values = new FormData(form); const submit = form.querySelector('[type="submit"]'); submit.disabled = true;
    try { await api('/api/portal/tasks', { method: 'POST', body: JSON.stringify(Object.fromEntries(values)) }); form.reset(); $('#taskDialog').close(); portal.taskFilter = 'OPEN'; await loadWorkspace(); navigate('tasks'); toast('Task assigned and added to the Action Center.'); }
    catch (error) { toast(error.message); }
    finally { submit.disabled = false; }
  });
  $('#chatForm').addEventListener('submit', async event => {
    event.preventDefault();
    const text = $('#chatInput').value.trim(); const recipientId = portal.activeChatUserId; const button = event.currentTarget.querySelector('button[type="submit"]');
    if (!recipientId || !text) return;
    button.disabled = true;
    try {
      const message = await api('/api/portal/chat/messages', { method: 'POST', body: JSON.stringify({ recipientId, text }) });
      if (portal.activeChatUserId === recipientId && !portal.chatMessages.some(item => item.id === message.id)) portal.chatMessages.push(message);
      $('#chatInput').value = ''; renderChatMessages(true);
    } catch (error) { toast(error.message); }
    finally { button.disabled = !portal.activeChatUserId; }
  });
}
function bindApp() {
  $('#loginForm').addEventListener('submit', async event => {
    event.preventDefault(); $('#loginMessage').textContent = '';
    const formElement = event.currentTarget; const form = new FormData(formElement);
    try { const result = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: form.get('email'), password: form.get('password') }) }); portal.user = result.user; portal.companies = result.companies; formElement.reset(); renderCompanyChoice(); }
    catch (error) { $('#loginMessage').textContent = error.message; }
  });
  $('#signupForm').addEventListener('submit', async event => {
    event.preventDefault(); $('#signupMessage').textContent = '';
    const formElement = event.currentTarget; const form = new FormData(formElement);
    try { const result = await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ name: form.get('name'), companyName: form.get('companyName'), email: form.get('email'), password: form.get('password') }) }); portal.user = result.user; portal.companies = result.companies; formElement.reset(); renderCompanyChoice(); }
    catch (error) { $('#signupMessage').textContent = error.message; }
  });
  $$('.auth-mode-tab').forEach(tab => tab.addEventListener('click', () => setAuthMode(tab.dataset.authMode)));
  $('#togglePassword').addEventListener('click', () => { const input = $('#loginPassword'); input.type = input.type === 'password' ? 'text' : 'password'; });
  $('#backToLogin').addEventListener('click', async () => { await api('/api/auth/logout', { method: 'POST' }).catch(() => {}); showLogin(); });
  $('#logoutBtn').addEventListener('click', async () => { await api('/api/auth/logout', { method: 'POST' }).catch(() => {}); showLogin(); });
  $('#portalCompanySelect').addEventListener('change', event => selectCompany(event.target.value));
  $('#navCompanyButton').addEventListener('click', renderCompanyChoice);
  $('.topbar .portal-brand').addEventListener('click', event => { event.preventDefault(); navigate('home'); });
  $('#reviewAttention').addEventListener('click', () => { portal.projectTeam = 'all'; portal.projectHealthFilter = 'attention'; navigate('projects'); });
  $$('.nav-link').forEach(link => link.addEventListener('click', () => navigate(link.dataset.page)));
  $$('[data-go]').forEach(button => button.addEventListener('click', () => navigate(button.dataset.go)));
  $('#createAnnouncement').addEventListener('click', () => $('#announcementDialog').showModal());
  $('#createUser').addEventListener('click', () => { fillTeamChoices($('#userTeamChoices'), portal.teams); $('#userDialog').showModal(); });
  $('#createTeam').addEventListener('click', () => { fillMemberChoices($('#teamMemberChoices'), portal.users); $('#teamDialog').showModal(); });
  $('#createProject').addEventListener('click', () => { if (!portal.teams.length) return toast('Join or create a team before starting a project.'); $('#projectDialog').showModal(); });
  $('#createTask').addEventListener('click', () => { if (!portal.projects.length) return toast('Create a project before assigning its first task.'); $('#taskDialog').showModal(); });
  $('#projectForm').elements.teamId.addEventListener('change', event => { $('#projectForm').elements.ownerId.innerHTML = projectOwnerOptions(event.target.value, portal.user.id); });
  $('#taskForm').elements.projectId.addEventListener('change', event => { const project = portal.projects.find(item => item.id === event.target.value); $('#taskForm').elements.ownerId.innerHTML = projectOwnerOptions(project?.teamId, portal.user.id); });
  $('#chatContactSearch').addEventListener('input', renderChatContacts);
  $('#chatInput').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); $('#chatForm').requestSubmit(); } });
  $('#chatMessages').addEventListener('scroll', updateChatJumpButton);
  $('#chatJumpLatest').addEventListener('click', () => $('#chatMessages').scrollTo({ top: $('#chatMessages').scrollHeight, behavior: 'smooth' }));
  $('#userSearch').addEventListener('input', event => renderUsers(event.target.value));
  $$('[data-close]').forEach(button => button.addEventListener('click', () => $(`#${button.dataset.close}`).close()));
  $('#userForm').elements.role.addEventListener('change', event => { $('#userTeamChoices').classList.toggle('hidden', event.target.value === 'ADMIN'); });
}
document.addEventListener('DOMContentLoaded', () => { bindApp(); bindForms(); bootstrap(); });
