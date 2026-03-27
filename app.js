
'use strict';

const CONFIG = {
  companyDomain: 'gensigma.com',
  allowedDomains: ['gensigma.com', 'domain.com'],
  adminAllowedDomains: ['gensigma.com'],
  superAdminDomain: 'gensigma.com',
  supabaseUrl: 'https://rfkjolbmkfnsgdgxbhxq.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJma2pvbGJta2Zuc2dkZ3hiaHhxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzOTA1MDgsImV4cCI6MjA4OTk2NjUwOH0.lqObEPXshQehkfKJgpAn7c-VOXcM6fNkkY904JCULdo',
  authStatusApiUrl: '/api/auth-status',
  userAdminApiUrl: '/api/admin-users',
  siteId: 'YOUR_SHAREPOINT_SITE_ID',
  driveId: 'YOUR_DOCUMENT_LIBRARY_DRIVE_ID',
  workbookPath: '/Shared Documents/PartnerMasterData.xlsx',
  partnerRootFolder: '/Shared Documents/Partners',
  partnersTableName: 'TablePartners',
  readerGroups: ['PartnerPortal_Readers'],
  editorGroups: ['PartnerPortal_BD_Owners', 'PartnerPortal_Admins'],
  pptRefreshFlowUrl: '',
  insightsApiUrl: '/api/partner-insights',
  graphScopes: ['User.Read', 'Files.ReadWrite.All', 'Sites.ReadWrite.All', 'GroupMember.Read.All']
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

const GRAPH_ROOT = 'https://graph.microsoft.com/v1.0';

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
let authOtpPending = false;
let authOtpEmail = '';
let pendingSignupProfile = null;

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
  await resolveRole();
  await tryLoadPartners();
  updateAuthUi();
  setSyncStatus('ready', `Signed in as ${currentUser.email}`);
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

async function acquireToken() {
  return accessToken;
}

async function signIn() {
  try {
    const email = readValue('authEmail').toLowerCase();
    validateAllowedDomain(email);
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
    setAuthStatus('info', 'Sending OTP to your email...');
    const { error } = await supabaseClient.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false
      }
    });
    if (error) throw error;
    authOtpPending = true;
    authOtpEmail = email;
    pendingSignupProfile = null;
    switchAuthMode('signin');
    setAuthStatus('success', 'OTP sent. Enter the 6-digit code from your inbox to complete sign in.');
  } catch (error) {
    handleError(error, 'Portal sign-in failed.');
  }
}

async function signUp() {
  try {
    const email = readValue('authEmail').toLowerCase();
    const fullName = readValue('authFullName');
    const requestedRole = document.getElementById('authRequestedRole')?.value || 'business_development_executive';

    validateAllowedDomain(email);
    validateRequestedRole(email, requestedRole);
    if (!fullName) {
      throw new Error('Full Name is required for sign up.');
    }
    const existingStatus = await fetchAuthStatus(email);
    if (existingStatus.exists) {
      throw new Error('An account request already exists for this email. Sign in instead or contact an administrator.');
    }

    setAuthStatus('info', 'Sending OTP to verify your organization email...');
    const superAdminCount = await getApprovedSuperAdminCount();
    const shouldBootstrapSuperAdmin =
      requestedRole === 'super_admin' &&
      email.endsWith(`@${CONFIG.superAdminDomain}`) &&
      superAdminCount === 0;

    const { error } = await supabaseClient.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
        data: { full_name: fullName }
      }
    });
    if (error) throw error;

    authOtpPending = true;
    authOtpEmail = email;
    pendingSignupProfile = {
      email,
      fullName,
      requestedRole,
      shouldBootstrapSuperAdmin
    };
    switchAuthMode('signup');
    setAuthStatus('success', 'OTP sent. Enter the 6-digit code from your inbox to complete sign up.');
  } catch (error) {
    handleError(error, 'Portal sign-up failed.');
  }
}

async function signOut() {
  await supabaseClient.auth.signOut();
  currentUser = null;
  currentPortalAccess = null;
  currentRole = 'anonymous';
  accessToken = '';
  partners = [];
  filteredPartners = [];
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
  showLoading('Syncing partner data from SharePoint...');
  try {
    const workbookItemId = await getWorkbookItemId();
    const table = await graphGet(
      `/drives/${CONFIG.driveId}/items/${workbookItemId}/workbook/tables/${encodeURIComponent(CONFIG.partnersTableName)}/rows`
    );
    partners = (table.value || []).map((row, index) => mapWorkbookRow(row, index)).filter(Boolean);
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
    setSyncStatus('warning', 'Portal access ready. Backend sync still needs configuration.');
  }
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
    showLoading('Saving partner to SharePoint...');
    const workbookItemId = await getWorkbookItemId();

    await graphPost(
      `/drives/${CONFIG.driveId}/items/${workbookItemId}/workbook/tables/${encodeURIComponent(CONFIG.partnersTableName)}/rows/add`,
      { index: null, values: [partnerToWorkbookRow(partner)] }
    );

    const folderPath = await ensurePartnerFolder(partner.company);
    await uploadSelectedFiles(folderPath, document.getElementById('f-files')?.files);
    await triggerCapabilityRefresh(partner);
    await loadPartners();
    clearAddForm();
    resetOpportunityRows('f-opp-list');
    navigate('database');
    showToast('Partner saved to Microsoft 365.', 'success');
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
  const oppTags = partner.opportunities.length
    ? partner.opportunities.map((opp) => `<span class="tag">${esc(opp)}</span>`).join('')
    : '<span class="empty-text">No opportunities added</span>';
  const fileHtml = files.length
    ? files.map((file) => `<a class="file-link" href="${file.webUrl}" target="_blank" rel="noopener">${esc(file.name)}</a>`).join('')
    : '<span class="empty-text">No files uploaded yet</span>';

  return `
    <div class="detail-grid">
      <div class="detail-item"><span class="detail-label">Employee</span><span class="detail-value">${esc(partner.employee)}</span></div>
      <div class="detail-item"><span class="detail-label">Company</span><span class="detail-value">${partner.website ? `<a href="${esc(partner.website)}" target="_blank" rel="noopener">${esc(partner.company)}</a>` : esc(partner.company)}</span></div>
      <div class="detail-item"><span class="detail-label">Contact</span><span class="detail-value">${esc(partner.contact || '—')}</span></div>
      <div class="detail-item"><span class="detail-label">Email</span><span class="detail-value">${esc(partner.email || '—')}</span></div>
      <div class="detail-item"><span class="detail-label">Status</span><span class="detail-value">${esc(partner.status || '—')}</span></div>
      <div class="detail-item"><span class="detail-label">Sourcing Event ID</span><span class="detail-value">${esc(partner.eventId || '—')}</span></div>
      <div class="detail-item full-width"><span class="detail-label">Technologies</span><div class="tags-wrap">${techTags || '<span class="empty-text">None</span>'}</div></div>
      <div class="detail-item full-width"><span class="detail-label">Opportunities</span><div class="tags-wrap">${oppTags}</div></div>
      <div class="detail-item full-width"><span class="detail-label">BD Notes</span><div class="detail-value">${esc(partner.notes || 'No notes added')}</div></div>
      <div class="detail-item full-width"><span class="detail-label">Overview</span><div class="detail-value">${esc(partner.capabilityStatement.overview || 'No overview')}</div></div>
      <div class="detail-item full-width"><span class="detail-label">Core Competencies</span><div class="tags-wrap">${renderArrayTags(partner.capabilityStatement.coreCompetencies)}</div></div>
      <div class="detail-item full-width"><span class="detail-label">Services</span><div class="tags-wrap">${renderArrayTags(partner.capabilityStatement.services)}</div></div>
      <div class="detail-item"><span class="detail-label">Industries</span><span class="detail-value">${esc(partner.capabilityStatement.industries || '—')}</span></div>
      <div class="detail-item"><span class="detail-label">Certifications</span><span class="detail-value">${esc(partner.capabilityStatement.certifications || '—')}</span></div>
      <div class="detail-item full-width"><span class="detail-label">Differentiators</span><div class="detail-value">${esc(partner.capabilityStatement.differentiators || '—')}</div></div>
      <div class="detail-item full-width"><span class="detail-label">Past Performance</span><div class="detail-value">${esc(partner.capabilityStatement.pastPerformance || '—')}</div></div>
      <div class="detail-item full-width"><span class="detail-label">SharePoint Files</span><div class="file-link-list">${fileHtml}</div></div>
      <div class="detail-item full-width">
        <span class="detail-label">Internal AI Capability View</span>
        <div class="detail-value">
          <div class="table-actions" style="margin-bottom:12px">
            <button class="icon-btn" onclick="loadPartnerInsights('${escAttr(partner.recordId)}', 'summary')">Generate PPT Summary</button>
            <button class="icon-btn" onclick="loadPartnerInsights('${escAttr(partner.recordId)}', 'score')">Score Opportunity Fit</button>
          </div>
          <div id="insightsPanel" class="detail-value">Generate a controlled internal summary or score from the partner data mirror.</div>
        </div>
      </div>
    </div>
  `;
}

function openEditModal(id) {
  if (!canCrudAccess()) {
    showToast('You have read-only access.', 'warning');
    return;
  }

  const partner = partners.find((entry) => entry.recordId === id);
  if (!partner) return;
  currentEditId = id;

  document.getElementById('editModalBody').innerHTML = `
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
        <input type="url" id="e-website" class="form-input" value="${escAttr(partner.website)}" />
      </div>
      <div class="form-group">
        <label class="form-label">Technologies</label>
        <input type="text" id="e-technologies" class="form-input" value="${escAttr(partner.technologies.join(', '))}" />
      </div>
      <div class="form-group">
        <label class="form-label">Partner Status <span class="required">*</span></label>
        <select id="e-status" class="form-input form-select">${buildStatusOptions(partner.status)}</select>
      </div>
      <div class="form-group">
        <label class="form-label">Sourcing Event ID</label>
        <input type="text" id="e-eventId" class="form-input" value="${escAttr(partner.eventId)}" />
      </div>
      <div class="form-group full-width">
        <label class="form-label">Opportunity Submitted</label>
        <input type="text" id="e-opportunities" class="form-input" value="${escAttr(partner.opportunities.join(', '))}" />
      </div>
      <div class="form-group full-width">
        <label class="form-label">BD Notes / Comments</label>
        <textarea id="e-notes" class="form-textarea" rows="3">${esc(partner.notes)}</textarea>
      </div>
      <div class="form-group full-width">
        <label class="form-label">Company Overview</label>
        <textarea id="e-overview" class="form-textarea" rows="3">${esc(partner.capabilityStatement.overview || '')}</textarea>
      </div>
      <div class="form-group full-width">
        <label class="form-label">Core Competencies</label>
        <input type="text" id="e-competencies" class="form-input" value="${escAttr((partner.capabilityStatement.coreCompetencies || []).join(', '))}" />
      </div>
      <div class="form-group full-width">
        <label class="form-label">Relevant Services</label>
        <input type="text" id="e-services" class="form-input" value="${escAttr((partner.capabilityStatement.services || []).join(', '))}" />
      </div>
      <div class="form-group full-width">
        <label class="form-label">Industries Served</label>
        <input type="text" id="e-industries" class="form-input" value="${escAttr(partner.capabilityStatement.industries || '')}" />
      </div>
      <div class="form-group full-width">
        <label class="form-label">Differentiators</label>
        <textarea id="e-differentiators" class="form-textarea" rows="2">${esc(partner.capabilityStatement.differentiators || '')}</textarea>
      </div>
      <div class="form-group full-width">
        <label class="form-label">Past Performance</label>
        <textarea id="e-pastPerformance" class="form-textarea" rows="2">${esc(partner.capabilityStatement.pastPerformance || '')}</textarea>
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
      opportunities: splitCommaValues(readValue('e-opportunities')),
      eventId: readValue('e-eventId'),
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
    showLoading('Updating partner in SharePoint...');

    const workbookItemId = await getWorkbookItemId();
    await graphPatch(
      `/drives/${CONFIG.driveId}/items/${workbookItemId}/workbook/tables/${encodeURIComponent(CONFIG.partnersTableName)}/rows/itemAt(index=${existing.rowIndex})/range`,
      { values: [partnerToWorkbookRow(updated)] }
    );

    const folderPath = await ensurePartnerFolder(updated.company);
    await uploadSelectedFiles(folderPath, document.getElementById('e-files')?.files);
    await triggerCapabilityRefresh(updated);
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
    showToast('You have read-only access.', 'warning');
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

    showLoading('Deleting partner from SharePoint...');
    const workbookItemId = await getWorkbookItemId();
    await graphDelete(
      `/drives/${CONFIG.driveId}/items/${workbookItemId}/workbook/tables/${encodeURIComponent(CONFIG.partnersTableName)}/rows/itemAt(index=${partner.rowIndex})`
    );

    closeModal('deleteModal');
    await loadPartners();
    showToast('Partner deleted successfully.', 'success');
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
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <div class="company-cell">
          <strong>${partner.website ? `<a href="${esc(partner.website)}" target="_blank" rel="noopener">${esc(partner.company)}</a>` : esc(partner.company)}</strong>
          <span>${esc(partner.contact || '')}</span>
        </div>
      </td>
      <td>${esc(partner.employee)}</td>
      <td><div class="tech-tag-group">${partner.technologies.map((tech) => `<span class="tech-tag">${esc(tech)}</span>`).join('')}</div></td>
      <td><span class="status-pill">${esc(partner.status)}</span></td>
      <td>${partner.opportunities.length ? esc(partner.opportunities.join(', ')) : '—'}</td>
      <td>${esc(partner.eventId || '—')}</td>
      <td>
        <div class="table-actions">
          <button class="icon-btn" onclick="openViewModal('${escAttr(partner.recordId)}')" title="View">View</button>
          <button class="icon-btn" onclick="openEditModal('${escAttr(partner.recordId)}')" title="Edit" ${!canCrudAccess() ? 'disabled' : ''}>Edit</button>
          <button class="icon-btn danger" onclick="openDeleteModal('${escAttr(partner.recordId)}')" title="Delete" ${!canCrudAccess() ? 'disabled' : ''}>Delete</button>
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
      <div class="recent-item">
        <div>
          <strong>${esc(partner.company)}</strong>
          <span>${esc(partner.employee)} • ${esc(partner.status)}</span>
        </div>
        <button class="btn btn-outline btn-xs" onclick="openViewModal('${escAttr(partner.recordId)}')">View</button>
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
          <span>${esc(tech)}</span>
          <div class="tech-bar-track"><div class="tech-bar-fill" style="width:${Math.min(count * 20, 100)}%"></div></div>
          <strong>${count}</strong>
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
  partners.forEach((partner) => {
    counts[partner.employee] = (counts[partner.employee] || 0) + 1;
  });

  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  document.getElementById('employeeAnalytics').innerHTML = entries.length
    ? entries.map(([employee, count]) => `<div class="metric-card"><strong>${esc(employee)}</strong><span>${count} partners</span></div>`).join('')
    : '<div class="empty-text">No employee activity available.</div>';
}

function renderStatusBreakdown() {
  const counts = {};
  partners.forEach((partner) => {
    counts[partner.status] = (counts[partner.status] || 0) + 1;
  });

  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  document.getElementById('statusBreakdown').innerHTML = entries.length
    ? entries.map(([status, count]) => `<div class="metric-card"><strong>${esc(status)}</strong><span>${count} partners</span></div>`).join('')
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

async function ensurePartnerFolder(company) {
  const root = encodeGraphPath(CONFIG.partnerRootFolder);
  const folderName = sanitizeFolderName(company);

  try {
    await graphGet(`/drives/${CONFIG.driveId}/root:${root}/${encodeURIComponent(folderName)}`);
  } catch (error) {
    if (error.status !== 404) throw error;
    await graphPost(`/drives/${CONFIG.driveId}/root:${root}:/children`, {
      name: folderName,
      folder: {},
      '@microsoft.graph.conflictBehavior': 'rename'
    });
  }

  return `${CONFIG.partnerRootFolder}/${folderName}`;
}

async function uploadSelectedFiles(folderPath, files) {
  const selectedFiles = Array.from(files || []).filter(Boolean);
  if (!selectedFiles.length) return;
  for (const file of selectedFiles) {
    const buffer = await file.arrayBuffer();
    const encodedFolder = encodeGraphPath(folderPath);
    const encodedName = encodeURIComponent(file.name);
    await graphPutBinary(`/drives/${CONFIG.driveId}/root:${encodedFolder}/${encodedName}:/content`, buffer, file.type || 'application/octet-stream');
  }
}

async function loadPartnerFiles(partner) {
  const folderPath = `${CONFIG.partnerRootFolder}/${sanitizeFolderName(partner.company)}`;
  const encodedFolder = encodeGraphPath(folderPath);
  const result = await graphGet(`/drives/${CONFIG.driveId}/root:${encodedFolder}:/children`);
  return result.value || [];
}

async function triggerCapabilityRefresh(partner) {
  if (!CONFIG.pptRefreshFlowUrl) return;
  await fetch(CONFIG.pptRefreshFlowUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      company: partner.company,
      recordId: partner.recordId,
      folderPath: `${CONFIG.partnerRootFolder}/${sanitizeFolderName(partner.company)}`,
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

async function getWorkbookItemId() {
  const item = await graphGet(`/drives/${CONFIG.driveId}/root:${encodeGraphPath(CONFIG.workbookPath)}`);
  return item.id;
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
    throw new Error('Your account has read-only access. Ask an admin to grant CRUD access.');
  }
}

function canCrudAccess() {
  return ['super_admin', 'shared_admin', 'business_development_executive', 'account_executive', 'bid_management', 'proposal_writer'].includes(currentRole);
}

async function upsertPortalUser(profile) {
  const { error } = await supabaseClient.from('portal_users').upsert(profile, { onConflict: 'user_id' });
  if (error) throw error;
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
          Requested: ${esc(formatRoleLabel(user.requested_role || 'hr_admin'))} | Current: ${esc(formatRoleLabel(user.shared_admin ? 'shared_admin' : (user.assigned_role || 'hr_admin')))} | Status: ${esc(user.status || 'pending')}
        </div>
        <div class="admin-user-actions">
          <select id="admin-role-${escAttr(user.user_id)}" class="filter-select">
            ${buildAdminRoleOptions(user.shared_admin ? 'shared_admin' : (user.assigned_role || 'hr_admin'))}
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

async function approvePortalUser(userId, email) {
  await updatePortalUserAccess(userId, email, 'approved');
}

async function rejectPortalUser(userId, email) {
  await updatePortalUserAccess(userId, email, 'rejected');
}

async function updatePortalUserAccess(userId, email, status) {
  const roleField = document.getElementById(`admin-role-${userId}`);
  const assignedRole = roleField?.value || 'hr_admin';
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

async function verifyAuthOtp() {
  try {
    const email = authOtpEmail || readValue('authEmail').toLowerCase();
    const token = readValue('authOtp');
    if (!email || !token) {
      throw new Error('Enter the OTP sent to your email.');
    }

    setAuthStatus('info', 'Verifying OTP...');
    const { data, error } = await supabaseClient.auth.verifyOtp({
      email,
      token,
      type: 'email'
    });
    if (error) throw error;

    if (authMode === 'signup' && pendingSignupProfile) {
      await upsertPortalUser({
        user_id: data.user.id,
        email: pendingSignupProfile.email,
        full_name: pendingSignupProfile.fullName,
        requested_role: pendingSignupProfile.requestedRole,
        assigned_role: pendingSignupProfile.shouldBootstrapSuperAdmin ? 'super_admin' : 'hr_admin',
        status: pendingSignupProfile.shouldBootstrapSuperAdmin ? 'approved' : 'pending',
        shared_admin: false
      });

      if (!pendingSignupProfile.shouldBootstrapSuperAdmin) {
        await supabaseClient.auth.signOut();
        resetAuthForm(true);
        setAuthStatus('success', 'Email verified. Your signup is now pending admin approval.');
        return;
      }
    }

    currentUser = normalizeUser(data.user);
    accessToken = data.session?.access_token || '';
    validateCompanyEmail(currentUser.email);
    await resolveRole();
    await tryLoadPartners();
    closeModal('authModal');
    updateAuthUi();
    setSyncStatus('ready', `Signed in as ${currentUser.email}`);
    showToast(authMode === 'signup' ? 'Email verified and account created.' : 'Signed in successfully.', 'success');
  } catch (error) {
    handleError(error, 'OTP verification failed.');
  }
}

async function graphGet(path) {
  return graphRequest(path, { method: 'GET' });
}

async function graphPost(path, body) {
  return graphRequest(path, { method: 'POST', body: JSON.stringify(body) });
}

async function graphPatch(path, body) {
  return graphRequest(path, { method: 'PATCH', body: JSON.stringify(body) });
}

async function graphDelete(path) {
  return graphRequest(path, { method: 'DELETE' });
}

async function graphPutBinary(path, body, contentType) {
  return graphRequest(path, { method: 'PUT', body, contentType });
}

async function graphRequest(path, options = {}) {
  accessToken = accessToken || await acquireToken();
  const headers = {
    Authorization: `Bearer ${accessToken}`
  };

  if (options.contentType) {
    headers['Content-Type'] = options.contentType;
  } else if (options.body && typeof options.body === 'string') {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`${GRAPH_ROOT}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body
  });

  if ((response.status === 401 || response.status === 403) && !options._retried) {
    accessToken = await acquireToken();
    return graphRequest(path, { ...options, _retried: true });
  }

  if (!response.ok) {
    const text = await response.text();
    const error = new Error(text || `Graph request failed with ${response.status}`);
    error.status = response.status;
    throw error;
  }

  if (response.status === 204) return {};
  const contentType = response.headers.get('content-type') || '';
  return contentType.includes('application/json') ? response.json() : response.text();
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
      <input type="text" class="form-input opp-opportunity" placeholder="Opportunity Submitted / Reached Out To" value="${escAttr(opportunity)}" />
      <input type="text" class="form-input opp-event" placeholder="Sourcing Event ID" value="${escAttr(eventId)}" />
      <button type="button" class="btn-remove-opp" onclick="removeOpportunityRow(this)">Remove</button>
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

function sanitizeFolderName(value) {
  return String(value || 'Partner')
    .replace(/[\\/:*?"<>|#%&{}~]/g, '')
    .trim()
    .slice(0, 100) || 'Partner';
}

function encodeGraphPath(path) {
  return path.split('/').map((part) => encodeURIComponent(part)).join('/');
}

function generateId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `partner-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
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
      ? `Create your portal account with your approved company email, then verify it with the OTP sent to that inbox. The first approved <strong>Super Admin</strong> must use <strong>@${esc(CONFIG.superAdminDomain)}</strong>.`
      : 'Sign in by requesting an OTP to your approved portal email and verifying it from that inbox.'
  );
}

function updateAuthUi() {
  const button = document.getElementById('authBtn');
  const adminButton = document.getElementById('adminBtn');
  if (!button) return;

  if (!currentUser) {
    button.textContent = 'Sign In';
    adminButton?.classList.add('hidden');
    setSyncStatus('idle', 'Sign in required');
    return;
  }

  button.textContent = 'Sign Out';
  adminButton?.classList.toggle('hidden', !canManageAccess());
  setSyncStatus('ready', `${formatRoleLabel(currentRole)} access`);
}

function openModal(id) {
  if (id === 'authModal') resetAuthForm(true);
  document.getElementById(id)?.classList.remove('hidden');
}

function closeModal(id) {
  document.getElementById(id)?.classList.add('hidden');
  if (id === 'authModal') resetAuthForm(true);
}

function resetAuthForm(resetMode = false) {
  if (resetMode) authMode = 'signin';
  authOtpPending = false;
  authOtpEmail = '';
  pendingSignupProfile = null;
  ['authEmail', 'authOtp', 'authFullName'].forEach((id) => {
    const field = document.getElementById(id);
    if (field) field.value = '';
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
  authMode = mode === 'signup' ? 'signup' : 'signin';
  document.getElementById('signInModeBtn')?.classList.toggle('active', authMode === 'signin');
  document.getElementById('signUpModeBtn')?.classList.toggle('active', authMode === 'signup');
  document.querySelectorAll('.auth-signup-only').forEach((field) => {
    field.classList.toggle('hidden', authMode !== 'signup');
  });
  document.querySelectorAll('.auth-otp-only').forEach((field) => {
    field.classList.toggle('hidden', !authOtpPending);
  });
  const primary = document.getElementById('authPrimaryBtn');
  const switchBtn = document.getElementById('authSwitchBtn');
  if (primary) primary.textContent = authOtpPending ? 'Verify OTP' : 'Send OTP';
  if (switchBtn) switchBtn.textContent = authMode === 'signup' ? 'Back To Sign In' : 'Need An Account?';
  showAuthHint();
}

function toggleAuthMode() {
  switchAuthMode(authMode === 'signup' ? 'signin' : 'signup');
}

async function handleAuthPrimary() {
  if (authOtpPending) {
    await verifyAuthOtp();
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

