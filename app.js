
'use strict';

const CONFIG = {
  companyDomain: 'gensigma.com',
  allowedDomains: ['gensigma.com', 'domain.com'],
  adminAllowedDomains: ['gensigma.com'],
  superAdminDomain: 'gensigma.com',
  supabaseUrl: 'https://rfkjolbmkfnsgdgxbhxq.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJma2pvbGJta2Zuc2dkZ3hiaHhxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzOTA1MDgsImV4cCI6MjA4OTk2NjUwOH0.lqObEPXshQehkfKJgpAn7c-VOXcM6fNkkY904JCULdo',
  authStatusApiUrl: '/api/auth-status',
  signupRequestApiUrl: '/api/signup-request',
  userAdminApiUrl: '/api/admin-users',
  partnerFilesBucket: 'partner-files',
  readerGroups: ['PartnerPortal_Readers'],
  editorGroups: ['PartnerPortal_BD_Owners', 'PartnerPortal_Admins'],
  pptRefreshFlowUrl: '',
  insightsApiUrl: '/api/partner-insights'
};

const WORKFLOW_STATUSES = [
  { value: 'Call Completed', group: 'Onboarding' },
  { value: 'NDA Sent', group: 'Onboarding' },
  { value: 'NDA Signed', group: 'Onboarding' },
  { value: 'DC Sent', group: 'Onboarding' },
  { value: 'DC Received', group: 'Onboarding' },
  { value: 'DC Delayed', group: 'Onboarding' },
  { value: 'Submitted to RFP Team', group: 'Submission' },
  { value: 'Proposal Submitted', group: 'Submission' },
  { value: 'Contract Won', group: 'Outcome' },
  { value: 'Contract Lost', group: 'Outcome' },
  { value: 'Future Pipeline', group: 'Outcome' }
];

const PIPELINE_STATUSES = new Set([
  'Call Completed',
  'NDA Sent',
  'NDA Signed',
  'DC Sent',
  'DC Received',
  'DC Delayed',
  'Submitted to RFP Team',
  'Proposal Submitted',
  'Future Pipeline'
]);

const ROLE_OPTIONS = [
  { value: 'super_admin', label: 'Super Admin' },
  { value: 'shared_admin', label: 'Shared Admin' },
  { value: 'business_development_executive', label: 'Business Development Executive' },
  { value: 'account_executive', label: 'Account Executive' },
  { value: 'bid_management', label: 'Bid Management' },
  { value: 'proposal_writer', label: 'Proposal Writer' },
  { value: 'hr_admin', label: 'HR Admin' }
];

let partners = [];
let filteredPartners = [];
let currentDeleteId = null;
let currentEditId = null;
let currentUser = null;
let currentRole = 'anonymous';
let currentPortalAccess = null;
let accessToken = '';
let supabaseClient = null;
let authMode = 'signin';
let recoverySessionActive = false;
let currentAccessLevel = 'read';

document.addEventListener('DOMContentLoaded', async () => {
  initializeSupabase();
  bindUiEvents();
  setupNavigation();
  resetOpportunityRows('f-opp-list');
  renderTable([]);
  renderDashboard();
  renderAnalytics();
  updateEmployeeFilter();
  updateCounts();
  updateAuthUi();
  showAuthHint();

  try {
    await restoreSession();
  } catch (error) {
    handleError(error, 'Portal session could not be restored.');
  }
});

function initializeSupabase() {
  if (!window.supabase || !window.supabase.createClient) {
    throw new Error('Supabase client failed to load. Keep the Supabase browser script in index.html.');
  }

  supabaseClient = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true
    }
  });

  supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY' || getAuthFlowType() === 'recovery') {
      recoverySessionActive = true;
      currentUser = normalizeUser(session?.user || {});
      accessToken = session?.access_token || accessToken;
      switchAuthMode('reset');
      openModal('authModal');
      setAuthStatus('info', 'Set a new password for your account.');
    }
  });
}

function bindUiEvents() {
  document.getElementById('sidebarToggle')?.addEventListener('click', toggleSidebar);
  document.getElementById('f-files')?.addEventListener('change', () => updateSelectedFilesList('f-files', 'f-files-list'));
  document.getElementById('authBtn')?.addEventListener('click', () => {
    if (currentUser) {
      signOut();
      return;
    }
    resetAuthForm(true);
    openModal('authModal');
  });

  document.querySelectorAll('.modal-overlay').forEach((overlay) => {
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) closeModal(overlay.id);
    });
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      document.querySelectorAll('.modal-overlay:not(.hidden)').forEach((modal) => closeModal(modal.id));
    }
  });
}

async function restoreSession() {
  const { data, error } = await supabaseClient.auth.getSession();
  if (error) throw error;
  const session = data.session;
  if (!session?.user) return;

  currentUser = normalizeUser(session.user);
  accessToken = session.access_token || '';
  try {
    ensureEmailConfirmed(session.user);
    await resolveRole();
    await tryLoadPartners();
    updateAuthUi();
    setSyncStatus('ready', `Signed in as ${currentUser.email}`);
  } catch (error) {
    await supabaseClient.auth.signOut();
    resetPortalState();
    updateAuthUi();
    setSyncStatus('idle', 'Sign in required');
    throw error;
  }
}

function normalizeUser(user) {
  const email = (user.email || user.username || '').toLowerCase();
  return {
    id: user.id,
    name: user.user_metadata?.full_name || user.name || email,
    email,
    accessToken: user.access_token || ''
  };
}

function ensureEmailConfirmed(user) {
  const confirmedAt = user?.email_confirmed_at || user?.confirmed_at || '';
  if (!confirmedAt) {
    throw new Error('Email confirmation is required before sign in. Check your inbox and confirm your email first.');
  }
}

function resetPortalState() {
  currentUser = null;
  currentPortalAccess = null;
  currentRole = 'anonymous';
  currentAccessLevel = 'read';
  accessToken = '';
  partners = [];
  filteredPartners = [];
}

function getPortalUrl() {
  return window.location.origin === 'null'
    ? window.location.href.split('#')[0]
    : `${window.location.origin}${window.location.pathname}`;
}

function getAuthFlowType() {
  const hash = new URLSearchParams((window.location.hash || '').replace(/^#/, ''));
  const search = new URLSearchParams(window.location.search || '');
  return hash.get('type') || search.get('type') || '';
}

async function acquireToken() {
  return accessToken;
}

async function signIn() {
  try {
    const email = readValue('authEmail').toLowerCase();
    const password = readValue('authPassword');
    validateAllowedDomain(email);
    if (!password) {
      throw new Error('Password is required.');
    }
    const authStatus = await fetchAuthStatus(email);
    if (!authStatus.exists) {
      throw new Error('No portal account exists for this email. Use Sign Up first.');
    }
    if (authStatus.status === 'pending') {
      throw new Error('Your access request is pending. Please wait for admin approval.');
    }
    if (authStatus.status === 'rejected') {
      throw new Error('Your access request was rejected. Please contact an administrator.');
    }
    setAuthStatus('info', 'Signing you in...');
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email,
      password
    });
    if (error) throw error;

    ensureEmailConfirmed(data.user);
    currentUser = normalizeUser(data.user);
    accessToken = data.session?.access_token || '';
    validateCompanyEmail(currentUser.email);
    await resolveRole();
    await tryLoadPartners();
    closeModal('authModal');
    updateAuthUi();
    setSyncStatus('ready', `Signed in as ${currentUser.email}`);
    showToast('Signed in successfully.', 'success');
  } catch (error) {
    handleError(error, 'Portal sign-in failed.');
  }
}

async function signUp() {
  try {
    const email = readValue('authEmail').toLowerCase();
    const password = readValue('authPassword');
    const confirmPassword = readValue('authConfirmPassword');
    const fullName = readValue('authFullName');
    const requestedRole = document.getElementById('authRequestedRole')?.value || 'business_development_executive';

    validateAllowedDomain(email);
    validateRequestedRole(email, requestedRole);
    if (!password || password.length < 8) {
      throw new Error('Use a password with at least 8 characters.');
    }
    if (password !== confirmPassword) {
      throw new Error('Password and Confirm Password must match.');
    }
    if (!fullName) {
      throw new Error('Full Name is required for sign up.');
    }
    const existingStatus = await fetchAuthStatus(email);
    if (existingStatus.exists) {
      throw new Error('An account request already exists for this email. Sign in instead or contact an administrator.');
    }

    setAuthStatus('info', 'Creating your account and sending a confirmation email...');
    const approvedAccessAdminCount = await getApprovedAccessAdminCount();
    const shouldBootstrapSharedAdmin =
      requestedRole === 'shared_admin' &&
      CONFIG.adminAllowedDomains.map((entry) => entry.toLowerCase()).includes(email.split('@')[1] || '') &&
      approvedAccessAdminCount === 0;
    const shouldBootstrapSuperAdmin =
      requestedRole === 'super_admin' &&
      email.endsWith(`@${CONFIG.superAdminDomain}`) &&
      approvedAccessAdminCount === 0;

    const { data, error } = await supabaseClient.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
        emailRedirectTo: getPortalUrl()
      }
    });
    if (error) throw error;

    if (!data.user?.id) {
      throw new Error('Signup request was created, but the user ID was not returned.');
    }

    await createSignupRequest({
      user_id: data.user.id,
      email,
      full_name: fullName,
      requested_role: requestedRole,
      assigned_role: shouldBootstrapSuperAdmin ? 'super_admin' : (shouldBootstrapSharedAdmin ? 'shared_admin' : 'hr_admin'),
      status: (shouldBootstrapSuperAdmin || shouldBootstrapSharedAdmin) ? 'approved' : 'pending',
      shared_admin: shouldBootstrapSharedAdmin
    });

    await supabaseClient.auth.signOut();
    resetAuthForm(true);
    setAuthStatus(
      'success',
      shouldBootstrapSuperAdmin
        ? `Your account was created. Check <strong>${esc(email)}</strong> and confirm your email before signing in.`
        : shouldBootstrapSharedAdmin
          ? `Your shared admin account was created. Check <strong>${esc(email)}</strong> and confirm your email before signing in.`
          : `Your signup request was created. Check <strong>${esc(email)}</strong>, confirm your email, then wait for admin approval.`
    );
  } catch (error) {
    handleError(error, 'Portal sign-up failed.');
  }
}

async function startPasswordReset() {
  try {
    const email = readValue('authEmail').toLowerCase();
    validateAllowedDomain(email);
    const authStatus = await fetchAuthStatus(email);
    if (!authStatus.exists) {
      throw new Error('No portal account exists for this email. Use Sign Up first.');
    }

    setAuthStatus('info', 'Sending password reset email...');
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
      redirectTo: getPortalUrl()
    });

    if (error) throw error;
    setAuthStatus('success', `Password reset email sent to <strong>${esc(email)}</strong>. Open the link in that email to set a new password.`);
  } catch (error) {
    handleError(error, 'Password reset request failed.');
  }
}

async function completePasswordReset() {
  try {
    if (!recoverySessionActive) {
      throw new Error('Open the password reset link from your email to continue.');
    }

    const password = readValue('authPassword');
    const confirmPassword = readValue('authResetConfirmPassword');

    if (!password || password.length < 8) {
      throw new Error('Use a new password with at least 8 characters.');
    }
    if (password !== confirmPassword) {
      throw new Error('Password and Confirm New Password must match.');
    }

    setAuthStatus('info', 'Updating your password...');
    const { error } = await supabaseClient.auth.updateUser({ password });
    if (error) throw error;

    recoverySessionActive = false;
    await supabaseClient.auth.signOut();
    resetPortalState();
    resetAuthForm(true);
    switchAuthMode('signin');
    setAuthStatus('success', 'Password updated successfully. Sign in with your new password.');
    openModal('authModal');
  } catch (error) {
    handleError(error, 'Password reset failed.');
  }
}

async function signOut() {
  await supabaseClient.auth.signOut();
  resetPortalState();
  updateAuthUi();
  updateCounts();
  renderTable([]);
  renderDashboard();
  renderAnalytics();
  updateEmployeeFilter();
  setSyncStatus('idle', 'Sign in required');
  showAuthHint();
  resetAuthForm(true);
}

async function resolveRole() {
  if (!currentUser) {
    currentRole = 'anonymous';
    currentPortalAccess = null;
    return;
  }

  validateCompanyEmail(currentUser.email);

  const { data, error } = await supabaseClient
    .from('portal_users')
    .select('*')
    .eq('user_id', currentUser.id)
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    throw new Error('No access profile was found for your user. Sign up first or contact an admin.');
  }
  if (data.status !== 'approved') {
    throw new Error(`Your access request is ${data.status}. Please wait for admin approval.`);
  }
  validateAssignedRole(currentUser.email, data.shared_admin ? 'shared_admin' : (data.assigned_role || 'hr_admin'));

  currentPortalAccess = data;
  currentRole = data.shared_admin ? 'shared_admin' : (data.assigned_role || 'hr_admin');
  currentAccessLevel = inferAccessLevel(data);
}

function inferAccessLevel(accessProfile) {
  if (!accessProfile) return 'read';
  if (accessProfile.shared_admin || accessProfile.assigned_role === 'super_admin') return 'edit';
  return String(accessProfile.access_level || 'read').toLowerCase() === 'edit' ? 'edit' : 'read';
}

function validateCompanyEmail(email) {
  validateAllowedDomain(email);
}

function validateAllowedDomain(email) {
  const domain = String(email || '').split('@')[1]?.toLowerCase() || '';
  const allowed = (CONFIG.allowedDomains || []).map((entry) => entry.toLowerCase());
  if (!allowed.includes(domain)) {
    throw new Error(`Use an approved organization email. Allowed domains: ${allowed.join(', ')}`);
  }
}

function validateRequestedRole(email, role) {
  if (['shared_admin', 'super_admin'].includes(role)) {
    validateAssignedRole(email, role);
  }
}

function validateAssignedRole(email, role) {
  const domain = String(email || '').split('@')[1]?.toLowerCase() || '';
  const adminDomains = (CONFIG.adminAllowedDomains || []).map((entry) => entry.toLowerCase());
  if (role === 'shared_admin' && !adminDomains.includes(domain)) {
    throw new Error(`Only admin-approved domains can hold ${role} access.`);
  }
  if (role === 'super_admin' && domain !== String(CONFIG.superAdminDomain || '').toLowerCase()) {
    throw new Error(`Only @${CONFIG.superAdminDomain} users can hold super admin access.`);
  }
}

function setupNavigation() {
  document.querySelectorAll('.nav-item').forEach((item) => {
    item.addEventListener('click', (event) => {
      event.preventDefault();
      navigate(item.getAttribute('data-page'));
      closeSidebar();
    });
  });
}

function navigate(page) {
  if (page === 'add' && !canCrudAccess()) {
    showToast('Your account has read-only access.', 'warning');
    return;
  }

  document.querySelectorAll('.nav-item').forEach((item) => item.classList.remove('active'));
  document.querySelector(`[data-page="${page}"]`)?.classList.add('active');

  document.querySelectorAll('.page').forEach((section) => section.classList.add('hidden'));
  document.getElementById(`page-${page}`)?.classList.remove('hidden');

  const labels = {
    dashboard: 'Dashboard',
    analytics: 'Employee Analytics',
    database: 'Partner Database',
    add: 'Add Partner'
  };
  document.getElementById('pageBreadcrumb').textContent = labels[page] || page;

  if (page === 'dashboard') renderDashboard();
  if (page === 'analytics') renderAnalytics();
  if (page === 'database') filterPartners();
  if (page === 'add') {
    clearAddForm();
    resetOpportunityRows('f-opp-list');
  }
}

function toggleSidebar() {
  document.getElementById('sidebar')?.classList.toggle('open');
}

function closeSidebar() {
  document.getElementById('sidebar')?.classList.remove('open');
}

async function loadPartners() {
  await ensureSignedIn();
  showLoading('Syncing partner data...');
  try {
    const { data, error } = await supabaseClient
      .from('partners')
      .select('*')
      .order('updated_at', { ascending: false });

    if (error) throw error;
    partners = (data || []).map(mapSupabasePartner).filter(Boolean);
    filteredPartners = [...partners];
    updateCounts();
    updateEmployeeFilter();
    renderTable(filteredPartners);
    renderDashboard();
    renderAnalytics();
  } finally {
    hideLoading();
  }
}

async function tryLoadPartners() {
  try {
    await loadPartners();
  } catch (error) {
    console.warn('Partner backend not available yet:', error);
    setSyncStatus('warning', 'Portal access ready. Partner data backend still needs configuration.');
  }
}

function mapSupabasePartner(row) {
  if (!row) return null;

  return {
    rowIndex: null,
    recordId: String(row.id || ''),
    employee: String(row.employee || ''),
    company: String(row.company || ''),
    website: String(row.website || ''),
    contact: String(row.contact || ''),
    email: String(row.email || ''),
    technologies: Array.isArray(row.technologies) ? row.technologies.filter(Boolean) : splitPipeValues(row.technologies),
    status: String(row.status || ''),
    opportunities: Array.isArray(row.opportunities) ? row.opportunities.filter(Boolean) : splitPipeValues(row.opportunities),
    eventId: String(row.event_id || ''),
    notes: String(row.notes || ''),
    capabilityStatement: parseCapability(row.capability_statement),
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
    updatedBy: String(row.updated_by || '')
  };
}

function partnerToSupabasePayload(partner) {
  return {
    id: partner.recordId,
    employee: partner.employee,
    company: partner.company,
    website: partner.website,
    contact: partner.contact,
    email: partner.email,
    technologies: partner.technologies,
    status: partner.status,
    opportunities: partner.opportunities,
    event_id: partner.eventId,
    notes: partner.notes,
    capability_statement: partner.capabilityStatement,
    created_at: partner.createdAt,
    updated_at: partner.updatedAt,
    updated_by: partner.updatedBy
  };
}

function mapWorkbookRow(row, index) {
  const values = row.values?.[0];
  if (!values || values.length < 15) return null;

  return {
    rowIndex: index,
    recordId: String(values[0] || ''),
    employee: String(values[1] || ''),
    company: String(values[2] || ''),
    website: String(values[3] || ''),
    contact: String(values[4] || ''),
    email: String(values[5] || ''),
    technologies: splitPipeValues(values[6]),
    status: String(values[7] || ''),
    opportunities: splitPipeValues(values[8]),
    eventId: String(values[9] || ''),
    notes: String(values[10] || ''),
    capabilityStatement: parseCapability(values[11]),
    createdAt: String(values[12] || ''),
    updatedAt: String(values[13] || ''),
    updatedBy: String(values[14] || '')
  };
}

function partnerToWorkbookRow(partner) {
  return [
    partner.recordId,
    partner.employee,
    partner.company,
    partner.website,
    partner.contact,
    partner.email,
    partner.technologies.join('|'),
    partner.status,
    partner.opportunities.join('|'),
    partner.eventId,
    partner.notes,
    JSON.stringify(partner.capabilityStatement),
    partner.createdAt,
    partner.updatedAt,
    partner.updatedBy
  ];
}

async function addPartner() {
  try {
    await ensureEditor();
    const partner = collectPartnerFromForm();
    showLoading('Saving partner...');

    const { error } = await supabaseClient
      .from('partners')
      .insert(partnerToSupabasePayload(partner));

    if (error) throw error;

    await uploadSelectedFiles(partner, document.getElementById('f-files')?.files);
    await triggerCapabilityRefresh(partner);
    await writeAuditLog('partner_created', partner, { source: 'portal' });
    await loadPartners();
    clearAddForm();
    resetOpportunityRows('f-opp-list');
    navigate('database');
    showToast('Partner saved successfully.', 'success');
  } catch (error) {
    handleError(error, 'Partner save failed.');
  } finally {
    hideLoading();
  }
}

function collectPartnerFromForm() {
  const partner = {
    recordId: generateId(),
    employee: readValue('f-employee'),
    company: readValue('f-company'),
    website: normalizeWebsite(readValue('f-website')),
    contact: readValue('f-contact'),
    email: readValue('f-email'),
    technologies: splitCommaValues(readValue('f-technologies')),
    status: readValue('f-status'),
    opportunities: readOpportunityRows('f-opp-list'),
    eventId: readOpportunityEventIds('f-opp-list'),
    notes: readValue('f-bdNotes'),
    capabilityStatement: {
      overview: readValue('f-overview'),
      coreCompetencies: splitCommaValues(readValue('f-competencies')),
      services: splitCommaValues(readValue('f-services')),
      industries: readValue('f-industries'),
      differentiators: readValue('f-differentiators'),
      pastPerformance: readValue('f-pastPerformance'),
      certifications: readValue('f-certifications')
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    updatedBy: currentUser?.email || ''
  };

  validatePartner(partner);
  return partner;
}

function validatePartner(partner) {
  if (!partner.employee) throw new Error('Employee Name is required.');
  if (!partner.company) throw new Error('Company Name is required.');
  if (!partner.status) throw new Error('Partner Status is required.');
  if (partner.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(partner.email)) {
    throw new Error('Email Address is not valid.');
  }
  if (partner.website) {
    try {
      new URL(partner.website);
    } catch (error) {
      throw new Error('Company Website must be a valid URL.');
    }
  }
}
function openViewModal(id) {
  const partner = partners.find((entry) => entry.recordId === id);
  if (!partner) return;

  document.getElementById('viewModalTitle').textContent = partner.company || 'Partner Details';
  document.getElementById('viewModalBody').innerHTML = buildViewModalHtml(partner, []);
  const editBtn = document.getElementById('viewEditBtn');
  editBtn.style.display = canCrudAccess() ? 'inline-flex' : 'none';
  editBtn.onclick = () => {
    closeModal('viewModal');
    openEditModal(id);
  };
  openModal('viewModal');

  loadPartnerFiles(partner).then((files) => {
    document.getElementById('viewModalBody').innerHTML = buildViewModalHtml(partner, files);
    resetInsightsPanel();
  }).catch((error) => {
    console.warn('Partner file listing warning:', error);
  });
}

function buildViewModalHtml(partner, files) {
  const techTags = partner.technologies.map((tech) => `<span class="tech-tag">${esc(tech)}</span>`).join('');
  const competencyTags = (partner.capabilityStatement.coreCompetencies || []).map((item) => `<span class="tech-tag">${esc(item)}</span>`).join('');
  const serviceTags = (partner.capabilityStatement.services || []).map((item) => `<span class="service-tag">${esc(item)}</span>`).join('');
  const oppTags = partner.opportunities.length
    ? partner.opportunities.map((opp) => `<span class="tag">${esc(opp)}</span>`).join('')
    : '<span class="empty-text">No opportunities added</span>';
  const fileHtml = files.length
    ? files.map((file) => `
        <button class="file-link" type="button" onclick="openFilePreview('${escAttr(file.name)}', '${escAttr(file.webUrl)}')">
          ${esc(file.name)}
        </button>
      `).join('')
    : '<span class="empty-text">No files uploaded yet</span>';
  const companyInitials = (partner.company || 'P')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('');
  const safeWebsite = partner.website ? esc(partner.website) : '';
  const safeCompany = esc(partner.company || 'Partner');
  const safeStatus = esc(partner.status || '—');
  const statusClass = statusClassName(partner.status);
  const addedOn = formatDisplayDate(partner.createdAt);

  return `
    <div class="detail-header">
      <div class="detail-avatar">${esc(companyInitials)}</div>
      <div class="detail-heading">
        <div class="detail-company-name">${partner.website ? `<a class="detail-company-link" href="${safeWebsite}" target="_blank" rel="noopener">${safeCompany}</a>` : safeCompany}</div>
        <div class="detail-meta-row">
          <span>${esc(partner.contact || 'No contact')}</span>
          <span class="detail-meta-sep">•</span>
          <span>${esc(partner.email || 'No email')}</span>
          <span class="status-pill ${statusClass}">${safeStatus}</span>
        </div>
      </div>
    </div>
    <div class="modal-section-title">Partner Details</div>
    <div class="detail-summary-grid">
      <div class="summary-field">
        <div class="summary-label">Sourced By</div>
        <div class="summary-value">${esc(partner.employee || '—')}</div>
      </div>
      <div class="summary-field">
        <div class="summary-label">Status</div>
        <div class="summary-value"><span class="status-pill ${statusClass}">${safeStatus}</span></div>
      </div>
      <div class="summary-field">
        <div class="summary-label">Contact Email</div>
        <div class="summary-value">${partner.email ? `<a class="detail-company-link" href="mailto:${esc(partner.email)}">${esc(partner.email)}</a>` : '—'}</div>
      </div>
      <div class="summary-field">
        <div class="summary-label">Website</div>
        <div class="summary-value">${partner.website ? `<a class="detail-company-link" href="${safeWebsite}" target="_blank" rel="noopener">${safeWebsite}</a>` : '—'}</div>
      </div>
      <div class="summary-field">
        <div class="summary-label">Added On</div>
        <div class="summary-value">${esc(addedOn)}</div>
      </div>
      <div class="summary-field">
        <div class="summary-label">Sourcing Event ID</div>
        <div class="summary-value">${esc(partner.eventId || '—')}</div>
      </div>
    </div>

    <div class="modal-section-title">Technologies</div>
    <div class="detail-chip-row">${techTags || '<span class="empty-text">None</span>'}</div>

    <div class="modal-section-title">Opportunity Details</div>
    <div class="detail-stack-block">
      <div class="summary-label">Opportunities Submitted / Reached Out To</div>
      <div class="tags-wrap">${oppTags}</div>
    </div>
    <div class="detail-stack-block">
      <div class="summary-label">BD Owner Notes / Comments</div>
      <div class="detail-paragraph">${esc(partner.notes || 'No notes added')}</div>
    </div>

    <div class="modal-section-title">Capability Statement</div>
    <div class="detail-stack-block">
      <div class="summary-label">Company Overview</div>
      <div class="detail-paragraph">${esc(partner.capabilityStatement.overview || 'No overview')}</div>
    </div>
    <div class="detail-stack-block">
      <div class="summary-label">Core Competencies</div>
      <div class="detail-chip-row">${competencyTags || '<span class="empty-text">None</span>'}</div>
    </div>
    <div class="detail-stack-block">
      <div class="summary-label">Services</div>
      <div class="detail-chip-row">${serviceTags || '<span class="empty-text">None</span>'}</div>
    </div>
    <div class="detail-stack-block">
      <div class="summary-label">Industries Served</div>
      <div class="detail-paragraph">${esc(partner.capabilityStatement.industries || '—')}</div>
    </div>
    <div class="detail-stack-block">
      <div class="summary-label">Differentiators</div>
      <div class="detail-paragraph">${esc(partner.capabilityStatement.differentiators || '—')}</div>
    </div>
    <div class="detail-stack-block">
      <div class="summary-label">Past Performance</div>
      <div class="detail-paragraph">${esc(partner.capabilityStatement.pastPerformance || '—')}</div>
    </div>
    <div class="detail-stack-block">
      <div class="summary-label">Certifications</div>
      <div class="detail-paragraph">${esc(partner.capabilityStatement.certifications || '—')}</div>
    </div>
    <div class="detail-stack-block">
      <div class="summary-label">Partner Files</div>
      <div class="file-link-list">${fileHtml}</div>
    </div>
  `;
}

function openEditModal(id) {
  if (!canCrudAccess()) {
    showToast('Your account has read-only access.', 'warning');
    return;
  }

  const partner = partners.find((entry) => entry.recordId === id);
  if (!partner) return;
  currentEditId = id;
  const opportunityPairs = buildOpportunityPairs(partner);

  document.getElementById('editModalBody').innerHTML = `
    <div class="edit-modal-layout">
      <div class="modal-section-title">Partner Information</div>
      <div class="form-grid">
        <div class="form-group">
          <label class="form-label">Employee Name <span class="required">*</span></label>
          <input type="text" id="e-employee" class="form-input" value="${escAttr(partner.employee)}" />
        </div>
        <div class="form-group">
          <label class="form-label">Company Name <span class="required">*</span></label>
          <input type="text" id="e-company" class="form-input" value="${escAttr(partner.company)}" />
        </div>
        <div class="form-group">
          <label class="form-label">Contact Person</label>
          <input type="text" id="e-contact" class="form-input" value="${escAttr(partner.contact)}" />
        </div>
        <div class="form-group">
          <label class="form-label">Email Address</label>
          <input type="email" id="e-email" class="form-input" value="${escAttr(partner.email)}" />
        </div>
        <div class="form-group">
          <label class="form-label">Company Website</label>
          <input type="url" id="e-website" class="form-input" value="${escAttr(partner.website)}" placeholder="https://www.company.com" />
        </div>
        <div class="form-group">
          <label class="form-label">Technologies <span class="form-hint">(comma separated)</span></label>
          <input type="text" id="e-technologies" class="form-input" value="${escAttr(partner.technologies.join(', '))}" />
        </div>
        <div class="form-group">
          <label class="form-label">Partner Status <span class="required">*</span></label>
          <select id="e-status" class="form-input form-select">${buildStatusOptions(partner.status)}</select>
        </div>
      </div>

      <div class="modal-section-title">Opportunity Details</div>
      <div class="opp-list-header">
        <span class="form-label" style="margin:0">Opportunities Submitted / Reached Out To</span>
        <button type="button" class="btn-add-opp" onclick="addOpportunityRow('e-opp-list')">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add Opportunity
        </button>
      </div>
      <div id="e-opp-list" class="opp-list"></div>

      <div class="form-group full-width edit-spacer">
        <label class="form-label">BD Owner Notes / Comments</label>
        <textarea id="e-notes" class="form-textarea" rows="3" placeholder="Notes from the BD owner...">${esc(partner.notes)}</textarea>
      </div>

      <div class="modal-section-title">Capability Statement</div>
      <div class="form-group full-width">
        <label class="form-label">Company Overview</label>
        <textarea id="e-overview" class="form-textarea" rows="4">${esc(partner.capabilityStatement.overview || '')}</textarea>
      </div>
      <div class="form-group full-width">
        <label class="form-label">Core Competencies <span class="form-hint">(comma separated)</span></label>
        <input type="text" id="e-competencies" class="form-input" value="${escAttr((partner.capabilityStatement.coreCompetencies || []).join(', '))}" />
      </div>
      <div class="form-group full-width">
        <label class="form-label">Services <span class="form-hint">(comma separated)</span></label>
        <input type="text" id="e-services" class="form-input" value="${escAttr((partner.capabilityStatement.services || []).join(', '))}" />
      </div>
      <div class="form-group full-width">
        <label class="form-label">Industries Served</label>
        <input type="text" id="e-industries" class="form-input" value="${escAttr(partner.capabilityStatement.industries || '')}" />
      </div>
      <div class="form-group full-width">
        <label class="form-label">Differentiators</label>
        <textarea id="e-differentiators" class="form-textarea" rows="3">${esc(partner.capabilityStatement.differentiators || '')}</textarea>
      </div>
      <div class="form-group full-width">
        <label class="form-label">Past Performance</label>
        <textarea id="e-pastPerformance" class="form-textarea" rows="3">${esc(partner.capabilityStatement.pastPerformance || '')}</textarea>
      </div>
      <div class="form-group full-width">
        <label class="form-label">Certifications / Compliance</label>
        <input type="text" id="e-certifications" class="form-input" value="${escAttr(partner.capabilityStatement.certifications || '')}" />
      </div>
      <div class="form-group full-width">
        <label class="form-label">Upload Additional Files</label>
        <input type="file" id="e-files" class="form-input" multiple accept=".pdf,.doc,.docx,.ppt,.pptx" />
        <div class="file-selection-list hidden" id="e-files-list"></div>
      </div>
    </div>
  `;

  document.getElementById('e-files')?.addEventListener('change', () => updateSelectedFilesList('e-files', 'e-files-list'));
  const oppContainer = document.getElementById('e-opp-list');
  if (oppContainer) {
    oppContainer.innerHTML = '';
    opportunityPairs.forEach((pair) => addOpportunityRow('e-opp-list', pair.opportunity, pair.eventId));
    if (!opportunityPairs.length) addOpportunityRow('e-opp-list');
  }
  document.getElementById('saveEditBtn').onclick = saveEdit;
  openModal('editModal');
}

async function saveEdit() {
  try {
    await ensureEditor();
    const existing = partners.find((entry) => entry.recordId === currentEditId);
    if (!existing) throw new Error('Partner record could not be found.');

    const updated = {
      ...existing,
      employee: readValue('e-employee'),
      company: readValue('e-company'),
      website: normalizeWebsite(readValue('e-website')),
      contact: readValue('e-contact'),
      email: readValue('e-email'),
      technologies: splitCommaValues(readValue('e-technologies')),
      status: readValue('e-status'),
      opportunities: readOpportunityRows('e-opp-list'),
      eventId: readOpportunityEventIds('e-opp-list'),
      notes: readValue('e-notes'),
      capabilityStatement: {
        overview: readValue('e-overview'),
        coreCompetencies: splitCommaValues(readValue('e-competencies')),
        services: splitCommaValues(readValue('e-services')),
        industries: readValue('e-industries'),
        differentiators: readValue('e-differentiators'),
        pastPerformance: readValue('e-pastPerformance'),
        certifications: readValue('e-certifications')
      },
      updatedAt: new Date().toISOString(),
      updatedBy: currentUser?.email || ''
    };

    validatePartner(updated);
    showLoading('Updating partner...');

    const payload = partnerToSupabasePayload(updated);
    delete payload.created_at;

    const { error } = await supabaseClient
      .from('partners')
      .update(payload)
      .eq('id', existing.recordId);

    if (error) throw error;

    await uploadSelectedFiles(updated, document.getElementById('e-files')?.files);
    await triggerCapabilityRefresh(updated);
    await writeAuditLog('partner_updated', updated, { previous: existing });
    closeModal('editModal');
    await loadPartners();
    showToast('Partner updated successfully.', 'success');
  } catch (error) {
    handleError(error, 'Partner update failed.');
  } finally {
    hideLoading();
  }
}

function openDeleteModal(id) {
  if (!canCrudAccess()) {
    showToast('Your account has read-only access.', 'warning');
    return;
  }

  const partner = partners.find((entry) => entry.recordId === id);
  if (!partner) return;
  currentDeleteId = id;
  document.getElementById('deletePartnerName').textContent = partner.company;
  document.getElementById('confirmDeleteBtn').onclick = confirmDelete;
  openModal('deleteModal');
}

async function confirmDelete() {
  try {
    await ensureEditor();
    const partner = partners.find((entry) => entry.recordId === currentDeleteId);
    if (!partner) throw new Error('Partner record could not be found.');

    showLoading('Deleting partner...');
    const { error } = await supabaseClient
      .from('partners')
      .delete()
      .eq('id', partner.recordId);

    if (error) throw error;

    await writeAuditLog('partner_deleted', partner, { retainedFiles: true });
    closeModal('deleteModal');
    await loadPartners();
    showToast('Partner deleted. Uploaded files were retained separately for recovery.', 'success');
  } catch (error) {
    handleError(error, 'Partner deletion failed.');
  } finally {
    hideLoading();
  }
}

function filterPartners() {
  const query = (document.getElementById('searchInput')?.value || '').trim().toLowerCase();
  const status = document.getElementById('statusFilter')?.value || '';
  const employee = document.getElementById('employeeFilter')?.value || '';

  filteredPartners = partners.filter((partner) => {
    const haystack = [
      partner.company,
      partner.employee,
      partner.contact,
      partner.email,
      partner.website,
      partner.status,
      partner.eventId,
      partner.notes,
      partner.technologies.join(' '),
      partner.opportunities.join(' '),
      partner.capabilityStatement.overview,
      (partner.capabilityStatement.coreCompetencies || []).join(' '),
      (partner.capabilityStatement.services || []).join(' ')
    ].join(' ').toLowerCase();

    const matchesQuery = !query || haystack.includes(query);
    const matchesStatus = !status || partner.status === status;
    const matchesEmployee = !employee || partner.employee === employee;
    return matchesQuery && matchesStatus && matchesEmployee;
  });

  renderTable(filteredPartners);
}
function renderTable(rows) {
  const body = document.getElementById('partnersTableBody');
  const emptyState = document.getElementById('emptyState');
  const tableCount = document.getElementById('tableCount');
  body.innerHTML = '';

  if (!rows.length) {
    emptyState.classList.remove('hidden');
    tableCount.textContent = '0 partners';
    return;
  }

  emptyState.classList.add('hidden');
  rows.forEach((partner) => {
    const companyInitials = (partner.company || 'P')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() || '')
      .join('');
    const visibleTech = partner.technologies.slice(0, 3);
    const overflowTech = partner.technologies.length - visibleTech.length;
    const statusClass = statusClassName(partner.status);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <div class="company-cell">
          <div class="company-avatar">${esc(companyInitials)}</div>
          <div class="company-stack">
            <div class="company-name">${partner.website ? `<a class="company-link" href="${esc(partner.website)}" target="_blank" rel="noopener">${esc(partner.company)}</a>` : esc(partner.company)}</div>
            <div class="company-email">${esc(partner.contact || 'No contact added')}</div>
          </div>
        </div>
      </td>
      <td>${esc(partner.employee)}</td>
      <td><span class="table-contact">${partner.email ? `<a class="company-link" href="mailto:${esc(partner.email)}">${esc(partner.email)}</a>` : '—'}</span></td>
      <td>
        <div class="tech-tag-group">
          ${visibleTech.map((tech) => `<span class="tech-tag">${esc(tech)}</span>`).join('')}
          ${overflowTech > 0 ? `<span class="tag tag-overflow">+${overflowTech}</span>` : ''}
        </div>
      </td>
      <td><span class="status-pill ${statusClass}">${esc(partner.status)}</span></td>
      <td><span class="table-date">${esc(formatDisplayDate(partner.createdAt))}</span></td>
      <td>
        <div class="table-actions compact">
          <button class="icon-btn icon-btn-view" onclick="openViewModal('${escAttr(partner.recordId)}')" title="View" aria-label="View partner">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
          ${canCrudAccess() ? `
            <button class="icon-btn icon-btn-edit" onclick="openEditModal('${escAttr(partner.recordId)}')" title="Edit" aria-label="Edit partner">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
            </button>
            <button class="icon-btn icon-btn-delete" onclick="openDeleteModal('${escAttr(partner.recordId)}')" title="Delete" aria-label="Delete partner">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/></svg>
            </button>
          ` : ''}
        </div>
      </td>
    `;
    body.appendChild(tr);
  });

  tableCount.textContent = `${rows.length} partner${rows.length === 1 ? '' : 's'}`;
}

function renderDashboard() {
  const total = partners.length;
  const pipeline = partners.filter((partner) => PIPELINE_STATUSES.has(partner.status)).length;
  const dc = partners.filter((partner) => partner.status === 'DC Received').length;
  const won = partners.filter((partner) => partner.status === 'Contract Won').length;
  const lost = partners.filter((partner) => partner.status === 'Contract Lost').length;

  setText('stat-total', total);
  setText('stat-pipeline', pipeline);
  setText('stat-dc', dc);
  setText('stat-won', won);
  setText('stat-lost', lost);

  const recent = [...partners]
    .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0))
    .slice(0, 5)
    .map((partner) => `
      <div class="recent-item" onclick="openViewModal('${escAttr(partner.recordId)}')">
        <div class="recent-avatar">${esc(getInitials(partner.company || 'P'))}</div>
        <div class="recent-info">
          <div class="recent-company">${esc(partner.company)}</div>
          <div class="recent-employee">by ${esc(partner.employee || 'Unknown')}</div>
        </div>
        <span class="status-pill ${statusClassName(partner.status)}">${esc(partner.status || '—')}</span>
      </div>
    `).join('');

  document.getElementById('recentPartners').innerHTML = recent || '<div class="empty-text">No partner records yet.</div>';
  renderTopTechnologies();
}

function renderTopTechnologies() {
  const counts = {};
  partners.forEach((partner) => {
    partner.technologies.forEach((tech) => {
      counts[tech] = (counts[tech] || 0) + 1;
    });
  });

  const top = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);

  document.getElementById('topTechnologies').innerHTML = top.length
    ? top.map(([tech, count]) => `
        <div class="tech-bar-row">
          <span class="tech-bar-name">${esc(tech)}</span>
          <div class="tech-bar-track"><div class="tech-bar-fill" style="width:${Math.min(count * 20, 100)}%"></div></div>
          <strong class="tech-bar-count">${count}</strong>
        </div>
      `).join('')
    : '<div class="empty-text">No technologies available.</div>';
}

function renderAnalytics() {
  renderEmployeeAnalytics();
  renderStatusBreakdown();
}

function renderEmployeeAnalytics() {
  const counts = {};
  const wonCounts = {};
  partners.forEach((partner) => {
    counts[partner.employee] = (counts[partner.employee] || 0) + 1;
    if (partner.status === 'Contract Won') {
      wonCounts[partner.employee] = (wonCounts[partner.employee] || 0) + 1;
    }
  });

  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const maxCount = entries.length ? Math.max(...entries.map(([, count]) => count), 1) : 1;
  document.getElementById('employeeAnalytics').innerHTML = entries.length
    ? entries.map(([employee, count]) => `
        <button class="employee-card" type="button" onclick="openEmployeeModal('${escAttr(employee)}')">
          <div class="employee-card-top">
            <div class="employee-avatar">${esc(getInitials(employee || 'P'))}</div>
            <div>
              <div class="employee-name">${esc(employee)}</div>
              <div class="employee-count">${count} partner${count === 1 ? '' : 's'} sourced</div>
            </div>
          </div>
          <div class="employee-stats-line">
            <span>${wonCounts[employee] || 0} contract${(wonCounts[employee] || 0) === 1 ? '' : 's'} won</span>
            <span>View partners</span>
          </div>
          <div class="employee-bar-track">
            <div class="employee-bar-fill" style="width:${Math.max((count / maxCount) * 100, 18)}%"></div>
          </div>
        </button>
      `).join('')
    : '<div class="empty-text">No employee activity available.</div>';
}

function openEmployeeModal(employee) {
  const employeeName = String(employee || '').trim();
  if (!employeeName) return;

  const employeePartners = partners
    .filter((partner) => String(partner.employee || '').trim().toLowerCase() === employeeName.toLowerCase())
    .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));

  const totalPartners = employeePartners.length;
  const contractsWon = employeePartners.filter((partner) => partner.status === 'Contract Won').length;

  document.getElementById('employeeModalTitle').textContent = `${employeeName} Overview`;
  document.getElementById('employeeModalBody').innerHTML = `
    <div class="employee-modal-summary">
      <div class="employee-modal-card">
        <div class="employee-modal-label">Employee</div>
        <div class="employee-modal-value">${esc(employeeName)}</div>
      </div>
      <div class="employee-modal-card">
        <div class="employee-modal-label">Partners In System</div>
        <div class="employee-modal-value">${totalPartners}</div>
      </div>
      <div class="employee-modal-card success">
        <div class="employee-modal-label">Contracts Won</div>
        <div class="employee-modal-value">${contractsWon}</div>
      </div>
    </div>
    <div class="modal-section-title">Partners Managed</div>
    <div class="employee-partner-list">
      ${employeePartners.length ? employeePartners.map((partner) => `
        <button class="employee-partner-row" type="button" onclick="closeModal('employeeModal'); openViewModal('${escAttr(partner.recordId)}')">
          <div class="employee-partner-left">
            <div class="employee-partner-avatar">${esc(getInitials(partner.company || 'P'))}</div>
            <div class="employee-partner-meta">
              <div class="employee-partner-company">${esc(partner.company || 'Partner')}</div>
              <div class="employee-partner-sub">${esc(partner.contact || partner.email || 'No contact')}</div>
            </div>
          </div>
          <div class="employee-partner-right">
            <span class="status-pill ${statusClassName(partner.status)}">${esc(partner.status || '—')}</span>
            <span class="employee-partner-date">${esc(formatDisplayDate(partner.createdAt))}</span>
          </div>
        </button>
      `).join('') : '<div class="empty-text">No partners found for this employee.</div>'}
    </div>
  `;

  openModal('employeeModal');
}

function renderStatusBreakdown() {
  const counts = WORKFLOW_STATUSES.reduce((accumulator, item) => {
    accumulator[item.value] = 0;
    return accumulator;
  }, {});

  partners.forEach((partner) => {
    const status = partner.status || '';
    counts[status] = (counts[status] || 0) + 1;
  });

  document.getElementById('statusBreakdown').innerHTML = WORKFLOW_STATUSES.length
    ? WORKFLOW_STATUSES.map(({ value: status }) => {
        const count = counts[status] || 0;
        return `
          <div class="status-breakdown-card ${statusCardClassName(status)}">
            <div class="status-breakdown-num">${count}</div>
            <div class="status-breakdown-label">${esc(status)}</div>
          </div>
        `;
      }).join('')
    : '<div class="empty-text">No statuses available.</div>';
}

function updateCounts() {
  setText('nav-partner-count', partners.length);
}

function updateEmployeeFilter() {
  const select = document.getElementById('employeeFilter');
  if (!select) return;

  const current = select.value;
  const employees = [...new Set(partners.map((partner) => partner.employee).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  select.innerHTML = '<option value="">All Employees</option>' + employees.map((employee) => `<option value="${escAttr(employee)}">${esc(employee)}</option>`).join('');
  select.value = employees.includes(current) ? current : '';
}

function exportCSV() {
  const rows = (filteredPartners.length ? filteredPartners : partners).map((partner) => ({
    Employee: partner.employee,
    Company: partner.company,
    Website: partner.website,
    Contact: partner.contact,
    Email: partner.email,
    Technologies: partner.technologies.join('; '),
    Status: partner.status,
    Opportunities: partner.opportunities.join('; '),
    EventID: partner.eventId,
    Notes: partner.notes,
    CapabilityStatement: JSON.stringify(partner.capabilityStatement)
  }));

  if (!rows.length) {
    showToast('No partner data available to export.', 'warning');
    return;
  }

  const header = Object.keys(rows[0]);
  const csv = [
    header.join(','),
    ...rows.map((row) => header.map((key) => csvEscape(row[key] || '')).join(','))
  ].join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `partners-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

async function uploadSelectedFiles(partner, files) {
  const selectedFiles = Array.from(files || []).filter(Boolean);
  if (!selectedFiles.length) return;
  if (!canCrudAccess()) {
    throw new Error('Your account has read-only access and cannot upload files.');
  }
  const folderPath = getPartnerStorageFolder(partner);

  for (const file of selectedFiles) {
    const extension = extractFileExtension(file.name);
    const baseName = sanitizeFileName(file.name.replace(/\.[^.]+$/, ''));
    const versionedName = `${new Date().toISOString().replace(/[:.]/g, '-')}-${baseName}${extension}`;
    const filePath = `${folderPath}/${versionedName}`;
    const { error } = await supabaseClient.storage
      .from(CONFIG.partnerFilesBucket)
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false
      });

    if (error) throw error;
  }
}

async function loadPartnerFiles(partner) {
  const folderPath = getPartnerStorageFolder(partner);
  const { data, error } = await supabaseClient.storage
    .from(CONFIG.partnerFilesBucket)
    .list(folderPath, {
      limit: 100,
      offset: 0,
      sortBy: { column: 'name', order: 'desc' }
    });

  if (error) throw error;

  const files = await Promise.all((data || [])
    .filter((entry) => entry.name && !entry.id?.endsWith('/'))
    .map(async (entry) => {
      const path = `${folderPath}/${entry.name}`;
      const signed = await supabaseClient.storage
        .from(CONFIG.partnerFilesBucket)
        .createSignedUrl(path, 60 * 60);

      return {
        name: entry.name,
        webUrl: signed.data?.signedUrl || '#'
      };
    }));

  return files.filter((file) => file.webUrl && file.webUrl !== '#');
}

function openFilePreview(name, url) {
  const safeName = String(name || 'Partner File');
  const safeUrl = String(url || '');
  if (!safeUrl) {
    showToast('File preview is unavailable for this document.', 'warning');
    return;
  }

  const extension = extractFileExtension(safeName);
  const previewBody = document.getElementById('filePreviewBody');
  const title = document.getElementById('filePreviewTitle');
  const openLink = document.getElementById('filePreviewOpenLink');
  if (!previewBody || !title || !openLink) return;

  title.textContent = safeName;
  openLink.href = safeUrl;
  previewBody.innerHTML = buildFilePreviewHtml(safeName, safeUrl, extension);
  openModal('filePreviewModal');
}

function closeFilePreview() {
  const previewBody = document.getElementById('filePreviewBody');
  const title = document.getElementById('filePreviewTitle');
  const openLink = document.getElementById('filePreviewOpenLink');
  if (previewBody) previewBody.innerHTML = '';
  if (title) title.textContent = 'File Preview';
  if (openLink) openLink.href = '#';
  closeModal('filePreviewModal');
}

function buildFilePreviewHtml(name, url, extension) {
  const ext = String(extension || '').toLowerCase();
  const escapedUrl = escAttr(url);
  const escapedName = esc(name);
  const officeExts = new Set(['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx']);
  const imageExts = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg']);
  const textExts = new Set(['.txt', '.csv', '.json', '.md', '.xml', '.log']);
  const mediaVideoExts = new Set(['.mp4', '.webm', '.mov', '.m4v', '.ogv']);
  const mediaAudioExts = new Set(['.mp3', '.wav', '.ogg', '.m4a']);

  if (ext === '.pdf') {
    return `
      <div class="file-preview-shell">
        <iframe class="file-preview-frame" src="${escapedUrl}" title="${escapedName}"></iframe>
      </div>
    `;
  }

  if (imageExts.has(ext)) {
    return `
      <div class="file-preview-image-wrap">
        <img class="file-preview-image" src="${escapedUrl}" alt="${escapedName}" />
      </div>
    `;
  }

  if (mediaVideoExts.has(ext)) {
    return `
      <div class="file-preview-shell media">
        <video class="file-preview-media" controls preload="metadata">
          <source src="${escapedUrl}" />
          Your browser could not play this video.
        </video>
      </div>
    `;
  }

  if (mediaAudioExts.has(ext)) {
    return `
      <div class="file-preview-audio-wrap">
        <div class="file-preview-fallback">
          <div class="file-preview-fallback-title">${escapedName}</div>
          <div class="file-preview-fallback-text">Audio file preview</div>
          <audio class="file-preview-audio" controls preload="metadata">
            <source src="${escapedUrl}" />
            Your browser could not play this audio file.
          </audio>
        </div>
      </div>
    `;
  }

  if (textExts.has(ext)) {
    return `
      <div class="file-preview-shell">
        <iframe class="file-preview-frame" src="${escapedUrl}" title="${escapedName}"></iframe>
      </div>
    `;
  }

  if (officeExts.has(ext)) {
    const officeViewerUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}`;
    return `
      <div class="file-preview-shell">
        <iframe class="file-preview-frame" src="${escAttr(officeViewerUrl)}" title="${escapedName}"></iframe>
      </div>
    `;
  }

  return `
    <div class="file-preview-fallback">
      <div class="file-preview-fallback-title">${escapedName}</div>
      <div class="file-preview-fallback-text">
        This file type cannot be rendered natively in every browser, but it stays inside the portal flow.
        Use the button below to open the original file if the embedded preview is unavailable.
      </div>
      <div class="file-preview-fallback-actions">
        <a class="btn btn-primary" href="${escapedUrl}" target="_blank" rel="noopener">Open File</a>
      </div>
    </div>
  `;
}

async function triggerCapabilityRefresh(partner) {
  if (!CONFIG.pptRefreshFlowUrl) return;
  await fetch(CONFIG.pptRefreshFlowUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      company: partner.company,
      recordId: partner.recordId,
      folderPath: getPartnerStorageFolder(partner),
      capabilityStatement: partner.capabilityStatement
    })
  });
}

function resetInsightsPanel() {
  const panel = document.getElementById('insightsPanel');
  if (!panel) return;
  panel.innerHTML = 'Generate a controlled internal summary or score from the partner data mirror.';
}

async function loadPartnerInsights(recordId, mode) {
  const panel = document.getElementById('insightsPanel');
  if (!panel) return;

  if (!CONFIG.insightsApiUrl || CONFIG.insightsApiUrl.includes('YOUR_BACKEND_HOST')) {
    panel.innerHTML = 'Add your backend insights endpoint in the app configuration before using this feature.';
    return;
  }

  panel.innerHTML = 'Generating internal AI output...';

  try {
    const response = await fetch(CONFIG.insightsApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recordId, mode })
    });

    if (!response.ok) {
      throw new Error(await response.text() || `Insights request failed with ${response.status}`);
    }

    const data = await response.json();
    panel.innerHTML = formatInsightsHtml(data, mode);
  } catch (error) {
    panel.innerHTML = esc(extractErrorMessage(error));
  }
}

function formatInsightsHtml(data, mode) {
  if (mode === 'score') {
    const score = esc(data.score ?? 'N/A');
    const reasons = (data.reasons || []).map((item) => `<li>${esc(item)}</li>`).join('');
    return `
      <div><strong>Future Opportunity Score:</strong> ${score}/100</div>
      <div style="margin-top:8px">${esc(data.summary || '')}</div>
      <ul style="margin-top:10px;padding-left:18px">${reasons || '<li>No reasons returned.</li>'}</ul>
    `;
  }

  const bullets = (data.slides || []).map((slide) => `
    <div style="margin-top:10px">
      <strong>${esc(slide.title || 'Slide')}</strong>
      <ul style="margin-top:6px;padding-left:18px">${(slide.bullets || []).map((bullet) => `<li>${esc(bullet)}</li>`).join('')}</ul>
    </div>
  `).join('');

  return `
    <div><strong>${esc(data.title || 'Capability Summary')}</strong></div>
    <div style="margin-top:8px">${esc(data.summary || '')}</div>
    ${bullets || '<div style="margin-top:8px">No slide output returned.</div>'}
  `;
}

async function ensureSignedIn() {
  if (!currentUser) {
    openModal('authModal');
    throw new Error('Sign in to the portal to continue.');
  }
  if (!accessToken) accessToken = await acquireToken();
}

async function ensureEditor() {
  await ensureSignedIn();
  if (!canCrudAccess()) {
    throw new Error('Your account has read-only access. Ask an admin to grant Edit access.');
  }
}

function canCrudAccess() {
  return canManageAccess() || currentAccessLevel === 'edit';
}

async function upsertPortalUser(profile) {
  const { error } = await supabaseClient.from('portal_users').upsert(profile, { onConflict: 'user_id' });
  if (error) throw error;
}

async function writeAuditLog(action, partner, extra = {}) {
  try {
    const payload = {
      record_id: partner?.recordId || null,
      action,
      actor_email: currentUser?.email || null,
      actor_role: currentRole || null,
      payload: {
        partner: partnerToSupabasePayload(partner || {}),
        ...extra
      },
      created_at: new Date().toISOString()
    };

    const { error } = await supabaseClient
      .from('partner_audit_logs')
      .insert(payload);

    if (error) {
      console.warn('Audit log write skipped:', error.message || error);
    }
  } catch (error) {
    console.warn('Audit log write skipped:', error);
  }
}

function canManageAccess() {
  return ['shared_admin', 'super_admin'].includes(currentRole);
}

async function getApprovedSuperAdminCount() {
  const { count, error } = await supabaseClient
    .from('portal_users')
    .select('user_id', { count: 'exact', head: true })
    .eq('assigned_role', 'super_admin')
    .eq('status', 'approved');

  if (error) throw error;
  return count || 0;
}

async function getApprovedAccessAdminCount() {
  const { data, error } = await supabaseClient
    .from('portal_users')
    .select('user_id, assigned_role, shared_admin')
    .eq('status', 'approved');

  if (error) throw error;
  return (data || []).filter((user) => user.shared_admin || user.assigned_role === 'super_admin').length;
}

async function openAdminModal() {
  if (!canManageAccess()) {
    showToast('Only admins can manage access.', 'warning');
    return;
  }

  openModal('adminModal');
  await loadAdminUsers();
}

async function loadAdminUsers() {
  if (!canManageAccess()) return;
  const container = document.getElementById('adminUsersList');
  const status = document.getElementById('adminStatus');
  if (!container || !status) return;

  try {
    status.textContent = 'Loading users...';
    const response = await fetch(CONFIG.userAdminApiUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (!response.ok) {
      status.textContent = await response.text() || 'Could not load portal users.';
      return;
    }
    const payload = await response.json();
    const data = payload.users || [];

    status.textContent = 'Approve pending users or update roles.';
    container.innerHTML = (data || []).map((user) => `
      <div class="admin-user-card">
        <div class="admin-user-email">${esc(user.email)}</div>
        <div class="admin-user-meta">
          Requested: ${esc(formatRoleLabel(user.requested_role || 'hr_admin'))} | Current: ${esc(formatRoleLabel(user.shared_admin ? 'shared_admin' : (user.assigned_role || 'hr_admin')))} | Access: ${esc(formatAccessLabel(user.access_level || inferAccessLevel(user)))} | Status: ${esc(user.status || 'pending')}
        </div>
        <div class="admin-user-actions">
          <select id="admin-role-${escAttr(user.user_id)}" class="filter-select">
            ${buildAdminRoleOptions(user.shared_admin ? 'shared_admin' : (user.assigned_role || 'hr_admin'))}
          </select>
          <select id="admin-access-${escAttr(user.user_id)}" class="filter-select">
            <option value="read" ${String(user.access_level || inferAccessLevel(user)) === 'read' ? 'selected' : ''}>Read Access</option>
            <option value="edit" ${String(user.access_level || inferAccessLevel(user)) === 'edit' ? 'selected' : ''}>Edit Access</option>
          </select>
          <button class="btn btn-outline btn-sm" onclick="approvePortalUser('${escAttr(user.user_id)}', '${escAttr(user.email)}')">Approve</button>
          <button class="btn btn-danger btn-sm" onclick="rejectPortalUser('${escAttr(user.user_id)}', '${escAttr(user.email)}')">Reject</button>
        </div>
      </div>
    `).join('') || '<div class="empty-text">No portal users found.</div>';
  } catch (error) {
    status.textContent = `Could not load portal users. ${extractErrorMessage(error)}`;
    container.innerHTML = '';
  }
}

function buildAdminRoleOptions(selected) {
  return ROLE_OPTIONS.map((role) => `<option value="${role.value}" ${role.value === selected ? 'selected' : ''}>${role.label}</option>`).join('');
}

function formatRoleLabel(roleValue) {
  return ROLE_OPTIONS.find((role) => role.value === roleValue)?.label || roleValue;
}

function formatAccessLabel(accessLevel) {
  return String(accessLevel || 'read').toLowerCase() === 'edit' ? 'Edit Access' : 'Read Access';
}

async function approvePortalUser(userId, email) {
  await updatePortalUserAccess(userId, email, 'approved');
}

async function rejectPortalUser(userId, email) {
  await updatePortalUserAccess(userId, email, 'rejected');
}

async function updatePortalUserAccess(userId, email, status) {
  const roleField = document.getElementById(`admin-role-${userId}`);
  const accessField = document.getElementById(`admin-access-${userId}`);
  const assignedRole = roleField?.value || 'hr_admin';
  const accessLevel = accessField?.value === 'edit' ? 'edit' : 'read';
  try {
    const response = await fetch(CONFIG.userAdminApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        userId,
        targetEmail: email,
        status,
        assignedRole,
        accessLevel,
        sharedAdmin: assignedRole === 'shared_admin'
      })
    });

    if (!response.ok) {
      showToast(await response.text() || 'Access update failed.', 'error');
      return;
    }

    showToast('User access updated.', 'success');
    await loadAdminUsers();
  } catch (error) {
    showToast(`Access update failed. ${extractErrorMessage(error)}`, 'error');
  }
}

async function fetchAuthStatus(email) {
  const response = await fetch(CONFIG.authStatusApiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ email })
  });

  if (!response.ok) {
    throw new Error(await response.text() || 'Could not verify account status.');
  }

  return response.json();
}

async function createSignupRequest(profile) {
  const response = await fetch(CONFIG.signupRequestApiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(profile)
  });

  if (!response.ok) {
    throw new Error(await response.text() || 'Could not create signup request.');
  }

  return response.json();
}

function clearAddForm() {
  [
    'f-employee',
    'f-company',
    'f-contact',
    'f-email',
    'f-website',
    'f-technologies',
    'f-status',
    'f-overview',
    'f-competencies',
    'f-services',
    'f-industries',
    'f-differentiators',
    'f-pastPerformance',
    'f-certifications',
    'f-bdNotes'
  ].forEach((id) => {
    const field = document.getElementById(id);
    if (field) field.value = '';
  });

  const files = document.getElementById('f-files');
  if (files) files.value = '';
  updateSelectedFilesList('f-files', 'f-files-list');
}

function buildStatusOptions(selectedValue = '') {
  let html = '<option value="">Select status...</option>';
  let currentGroup = '';
  WORKFLOW_STATUSES.forEach((status) => {
    if (status.group !== currentGroup) {
      if (currentGroup) html += '</optgroup>';
      html += `<optgroup label="${status.group}">`;
      currentGroup = status.group;
    }
    html += `<option value="${status.value}" ${selectedValue === status.value ? 'selected' : ''}>${status.value}</option>`;
  });
  if (currentGroup) html += '</optgroup>';
  return html;
}

function oppRowHTML(opportunity = '', eventId = '') {
  return `
    <div class="opp-row">
      <span class="opp-index"></span>
      <input type="text" class="form-input opp-opportunity" placeholder="Opportunity name / RFP title" value="${escAttr(opportunity)}" />
      <input type="text" class="form-input opp-event" placeholder="Event ID (e.g. EVT-2024-001)" value="${escAttr(eventId)}" />
      <button type="button" class="btn-remove-opp" aria-label="Remove opportunity" onclick="removeOpportunityRow(this)">×</button>
    </div>
  `;
}

function addOpportunityRow(containerId, opportunity = '', eventId = '') {
  const container = document.getElementById(containerId);
  if (!container) return;
  const wrapper = document.createElement('div');
  wrapper.innerHTML = oppRowHTML(opportunity, eventId).trim();
  container.appendChild(wrapper.firstElementChild);
  renumberOppRows(containerId);
}

function removeOpportunityRow(button) {
  const row = button.closest('.opp-row');
  const container = row?.parentElement;
  row?.remove();
  if (container && !container.querySelector('.opp-row')) {
    addOpportunityRow(container.id);
  } else if (container) {
    renumberOppRows(container.id);
  }
}

function renumberOppRows(containerId) {
  document.querySelectorAll(`#${containerId} .opp-row`).forEach((row, index) => {
    const badge = row.querySelector('.opp-index');
    if (badge) badge.textContent = `#${index + 1}`;
  });
}

function resetOpportunityRows(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';
  addOpportunityRow(containerId);
}

function readOpportunityRows(containerId) {
  return Array.from(document.querySelectorAll(`#${containerId} .opp-row`))
    .map((row) => row.querySelector('.opp-opportunity')?.value.trim() || '')
    .filter(Boolean);
}

function readOpportunityEventIds(containerId) {
  return Array.from(document.querySelectorAll(`#${containerId} .opp-row`))
    .map((row) => row.querySelector('.opp-event')?.value.trim() || '')
    .filter(Boolean)
    .join(' | ');
}

function buildOpportunityPairs(partner) {
  const opportunities = Array.isArray(partner?.opportunities) ? partner.opportunities : [];
  const eventIds = splitPipeValues(partner?.eventId || '');
  const length = Math.max(opportunities.length, eventIds.length, 1);
  return Array.from({ length }, (_, index) => ({
    opportunity: opportunities[index] || '',
    eventId: eventIds[index] || ''
  })).filter((entry, index) => index === 0 || entry.opportunity || entry.eventId);
}

function parseCapability(value) {
  if (!value) {
    return {
      overview: '',
      coreCompetencies: [],
      services: [],
      industries: '',
      differentiators: '',
      pastPerformance: '',
      certifications: ''
    };
  }

  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return {
      overview: parsed.overview || '',
      coreCompetencies: Array.isArray(parsed.coreCompetencies) ? parsed.coreCompetencies : [],
      services: Array.isArray(parsed.services) ? parsed.services : [],
      industries: parsed.industries || '',
      differentiators: parsed.differentiators || '',
      pastPerformance: parsed.pastPerformance || '',
      certifications: parsed.certifications || ''
    };
  } catch (error) {
    return {
      overview: String(value),
      coreCompetencies: [],
      services: [],
      industries: '',
      differentiators: '',
      pastPerformance: '',
      certifications: ''
    };
  }
}

function splitCommaValues(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitPipeValues(value) {
  return String(value || '')
    .split('|')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeWebsite(value) {
  if (!value) return '';
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

function sanitizeFileName(value) {
  return String(value || 'file')
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, '-')
    .replace(/[\\/:*?"<>|#%&{}~]/g, '-')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .replace(/\s+/g, '-')
    .trim()
    .slice(0, 100) || 'file';
}

function getPartnerStorageFolder(partner) {
  const companyName = sanitizeFileName(partner?.company || 'partner');
  return companyName || String(partner?.recordId || 'partner');
}

function extractFileExtension(name) {
  const match = String(name || '').match(/(\.[^.]+)$/);
  return match ? match[1].toLowerCase() : '';
}

function generateId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `partner-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function formatDisplayDate(value) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

function getInitials(value) {
  return String(value || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || 'P';
}

function statusClassName(status) {
  return `status-${String(status || '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9-]/g, '') || 'default'}`;
}

function statusCardClassName(status) {
  return `status-card-${String(status || '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9-]/g, '') || 'default'}`;
}

function readValue(id) {
  return document.getElementById(id)?.value.trim() || '';
}

function renderArrayTags(items) {
  return items && items.length
    ? items.map((item) => `<span class="tag">${esc(item)}</span>`).join('')
    : '<span class="empty-text">None</span>';
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function setAuthStatus(type, message) {
  const el = document.getElementById('authStatus');
  if (!el) return;
  el.className = 'config-status';
  if (type === 'error') el.classList.add('error');
  if (type === 'success') el.classList.add('success');
  el.innerHTML = message;
}

function setSyncStatus(mode, text) {
  const status = document.getElementById('syncStatus');
  const textEl = document.getElementById('syncText');
  if (!status || !textEl) return;
  status.dataset.state = mode;
  textEl.textContent = text;
}

function showAuthHint() {
  setAuthStatus(
    'info',
    authMode === 'signup'
      ? `Create your portal account with your approved company email and a password, then confirm the email from your inbox. The first approved <strong>Super Admin</strong> must use <strong>@${esc(CONFIG.superAdminDomain)}</strong>.`
      : authMode === 'reset'
        ? 'Enter your new password to complete the secure password reset flow.'
        : 'Sign in with your approved company email and password after your email is confirmed and your access request is approved.'
  );
}

function updateAuthUi() {
  const button = document.getElementById('authBtn');
  const adminButton = document.getElementById('adminBtn');
  const topbarAddButton = document.getElementById('topbarAddPartnerBtn');
  const databaseAddButton = document.getElementById('databaseAddPartnerBtn');
  const addNavLink = document.getElementById('navAddPartner');
  if (!button) return;

  if (!currentUser) {
    button.textContent = 'Sign In';
    adminButton?.classList.add('hidden');
    topbarAddButton?.classList.add('hidden');
    databaseAddButton?.classList.add('hidden');
    addNavLink?.classList.add('hidden');
    setSyncStatus('idle', 'Sign in required');
    return;
  }

  button.textContent = 'Sign Out';
  adminButton?.classList.toggle('hidden', !canManageAccess());
  topbarAddButton?.classList.toggle('hidden', !canCrudAccess());
  databaseAddButton?.classList.toggle('hidden', !canCrudAccess());
  addNavLink?.classList.toggle('hidden', !canCrudAccess());
  setSyncStatus('ready', `${formatRoleLabel(currentRole)} access`);
}

function openModal(id) {
  if (id === 'authModal' && !recoverySessionActive) resetAuthForm(true);
  document.getElementById(id)?.classList.remove('hidden');
}

function closeModal(id) {
  document.getElementById(id)?.classList.add('hidden');
  if (id === 'authModal' && !recoverySessionActive) resetAuthForm(true);
}

function resetAuthForm(resetMode = false) {
  if (resetMode) authMode = 'signin';
  if (resetMode) recoverySessionActive = false;
  ['authEmail', 'authPassword', 'authConfirmPassword', 'authResetConfirmPassword', 'authFullName'].forEach((id) => {
    const field = document.getElementById(id);
    if (field) {
      field.value = '';
      if (field.type === 'password') field.type = 'password';
    }
  });
  document.querySelectorAll('.password-toggle').forEach((button) => {
    button.textContent = 'Show';
  });
  const role = document.getElementById('authRequestedRole');
  if (role) role.value = 'business_development_executive';
  const status = document.getElementById('authStatus');
  if (status) {
    status.className = 'config-status';
    status.innerHTML = '';
  }
  switchAuthMode(authMode);
}

function updateSelectedFilesList(inputId, listId) {
  const input = document.getElementById(inputId);
  const list = document.getElementById(listId);
  if (!input || !list) return;

  const files = Array.from(input.files || []);
  if (!files.length) {
    list.innerHTML = '';
    list.classList.add('hidden');
    return;
  }

  list.innerHTML = files.map((file) => `<span class="file-selection-chip">${esc(file.name)}</span>`).join('');
  list.classList.remove('hidden');
}

function switchAuthMode(mode) {
  authMode = ['signup', 'reset'].includes(mode) ? mode : 'signin';
  document.getElementById('signInModeBtn')?.classList.toggle('active', authMode === 'signin');
  document.getElementById('signUpModeBtn')?.classList.toggle('active', authMode === 'signup');
  document.querySelectorAll('.auth-signup-only').forEach((field) => {
    field.classList.toggle('hidden', authMode !== 'signup');
  });
  document.querySelectorAll('.auth-signin-only').forEach((field) => {
    field.classList.toggle('hidden', authMode !== 'signin');
  });
  document.querySelectorAll('.auth-reset-only').forEach((field) => {
    field.classList.toggle('hidden', authMode !== 'reset');
  });
  document.getElementById('signInModeBtn')?.classList.toggle('hidden', authMode === 'reset');
  document.getElementById('signUpModeBtn')?.classList.toggle('hidden', authMode === 'reset');
  const primary = document.getElementById('authPrimaryBtn');
  const switchBtn = document.getElementById('authSwitchBtn');
  if (primary) primary.textContent = authMode === 'signup' ? 'Sign Up' : authMode === 'reset' ? 'Update Password' : 'Sign In';
  if (switchBtn) {
    switchBtn.textContent = authMode === 'signup' ? 'Back To Sign In' : authMode === 'reset' ? 'Back To Sign In' : 'Need An Account?';
    switchBtn.classList.toggle('hidden', false);
  }
  showAuthHint();
}

function toggleAuthMode() {
  switchAuthMode(authMode === 'signup' || authMode === 'reset' ? 'signin' : 'signup');
}

async function handleAuthPrimary() {
  if (authMode === 'reset') {
    await completePasswordReset();
    return;
  }
  if (authMode === 'signup') {
    await signUp();
    return;
  }
  await signIn();
}

function showLoading(message) {
  setText('loadingText', message || 'Working...');
  document.getElementById('loadingOverlay')?.classList.remove('hidden');
}

function hideLoading() {
  document.getElementById('loadingOverlay')?.classList.add('hidden');
}

function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  const icon = document.getElementById('toastIcon');
  const text = document.getElementById('toastMessage');
  if (!toast || !icon || !text) return;

  text.textContent = message;
  icon.textContent = type === 'success' ? '?' : type === 'warning' ? '!' : '×';
  toast.classList.remove('hidden');
  toast.dataset.type = type;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.add('hidden'), 3200);
}

function togglePasswordVisibility(fieldId, trigger) {
  const field = document.getElementById(fieldId);
  if (!field || !trigger) return;
  const isPassword = field.type === 'password';
  field.type = isPassword ? 'text' : 'password';
  trigger.textContent = isPassword ? 'Hide' : 'Show';
}

function handleError(error, fallbackMessage) {
  console.error(error);
  const details = extractErrorMessage(error);
  setAuthStatus('error', esc(details));
  showToast(details || fallbackMessage || 'Something went wrong.', 'error');
  hideLoading();
}

function extractErrorMessage(error) {
  if (!error) return 'Something went wrong.';
  if (typeof error === 'string') return error;
  if (error.message) return error.message;
  return 'Something went wrong.';
}

function csvEscape(value) {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escAttr(value) {
  return esc(value).replace(/`/g, '&#96;');
}

window.navigate = navigate;
window.signIn = signIn;
window.signUp = signUp;
window.switchAuthMode = switchAuthMode;
window.toggleAuthMode = toggleAuthMode;
window.togglePasswordVisibility = togglePasswordVisibility;
window.handleAuthPrimary = handleAuthPrimary;
window.addPartner = addPartner;
window.filterPartners = filterPartners;
window.exportCSV = exportCSV;
window.openAdminModal = openAdminModal;
window.loadAdminUsers = loadAdminUsers;
window.approvePortalUser = approvePortalUser;
window.rejectPortalUser = rejectPortalUser;
window.loadPartnerInsights = loadPartnerInsights;
window.openViewModal = openViewModal;
window.openEditModal = openEditModal;
window.openDeleteModal = openDeleteModal;
window.closeModal = closeModal;
window.addOpportunityRow = addOpportunityRow;
window.removeOpportunityRow = removeOpportunityRow;

