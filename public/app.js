// Global state
let contacts = [];
let groups = [];
let templates = [];
let selectedContacts = [];
let currentUser = null;

// Initialize
window.onload = async () => {
    await checkAuth();
    loadContacts();
    loadGroups();
    loadTemplates();
    loadHistory();
    loadStats();
    loadErrors();
    loadErrorStats();
    checkStatus();
    setInterval(checkStatus, 3000);
};

// Auth
async function checkAuth() {
    try {
        const res = await fetch('/api/auth/me');
        if (!res.ok) window.location = '/';
        const data = await res.json();
        currentUser = data.user;
        document.getElementById('username').textContent = data.user.username;
        // Set user avatar initial
        const avatar = document.getElementById('userAvatar');
        if (avatar) {
            avatar.textContent = data.user.username.charAt(0).toUpperCase();
        }
    } catch (e) {
        window.location = '/';
    }
}

async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location = '/';
}

// Tab switching
function switchTab(index) {
    document.querySelectorAll('nav a').forEach((t, i) => {
        t.classList.toggle('active', i === index);
    });
    document.querySelectorAll('.panel').forEach((p, i) => {
        p.classList.toggle('active', i === index);
    });
    
    // Close sidebar on mobile when tab is clicked
    const sidebar = document.querySelector('.sidebar');
    if (sidebar.classList.contains('open')) {
        sidebar.classList.remove('open');
    }
}

// WhatsApp Connection
async function connect() {
    try {
        await fetch('/api/connect', { method: 'POST' });
        setTimeout(checkStatus, 1000);
    } catch (e) {
        alert('Connection failed');
    }
}

async function disconnect() {
    try {
        await fetch('/api/disconnect', { method: 'POST' });
        document.getElementById('qr').style.display = 'none';
        document.getElementById('sessionExpiredMsg').style.display = 'none';
    } catch (e) {
        alert('Disconnect failed');
    }
}

async function clearSession() {
    if (!confirm('This will clear your WhatsApp session and you will need to scan a new QR code. Continue?')) {
        return;
    }
    try {
        const res = await fetch('/api/clear-session', { method: 'POST' });
        if (res.ok) {
            document.getElementById('qr').style.display = 'none';
            document.getElementById('sessionExpiredMsg').style.display = 'none';
            alert('Session cleared. You can now connect again.');
            checkStatus();
        } else {
            alert('Failed to clear session');
        }
    } catch (e) {
        alert('Failed to clear session: ' + e.message);
    }
}

async function checkStatus() {
    try {
        const res = await fetch('/api/status');
        const data = await res.json();
        const badge = document.getElementById('status');
        badge.textContent = data.status.charAt(0).toUpperCase() + data.status.slice(1);
        badge.className = 'badge ' + (data.status === 'connected' ? 'conn' : data.status === 'connecting' ? 'connecting' : 'disc');
        
        // Show session expired message if disconnected (might be due to 401)
        if (data.status === 'disconnected' && data.error) {
            document.getElementById('sessionExpiredMsg').style.display = 'block';
        } else {
            document.getElementById('sessionExpiredMsg').style.display = 'none';
        }
        
        if (data.status === 'connecting') {
            const qrRes = await fetch('/api/qr');
            if (qrRes.ok) {
                const qrData = await qrRes.json();
                document.getElementById('qrimg').src = qrData.qr;
                document.getElementById('qr').style.display = 'block';
            }
        } else {
            document.getElementById('qr').style.display = 'none';
        }
    } catch (e) {}
}

// Contacts
async function loadContacts() {
    try {
        const res = await fetch('/api/contacts');
        const data = await res.json();
        contacts = data.contacts || [];
        document.getElementById('ccount').textContent = data.count || 0;
        renderContacts(contacts);
    } catch (e) {
        console.error('Load contacts failed', e);
    }
}

function renderContacts(list) {
    const tbody = document.getElementById('ctable');
    if (!list || list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px">No contacts</td></tr>';
        return;
    }
    tbody.innerHTML = list.map(c => `
        <tr>
            <td><input type="checkbox" value="${c.id}" onchange="toggleContact(${c.id})"></td>
            <td>${c.name || ''}</td>
            <td>${c.phone || ''}</td>
            <td>${c.email || ''}</td>
            <td>${c.company || ''}</td>
            <td>
                <button onclick="editContact(${c.id})" class="btn btn-sm">Edit</button>
                <button onclick="deleteContact(${c.id})" class="btn btn-danger btn-sm">Delete</button>
            </td>
        </tr>
    `).join('');
}

function toggleContact(id) {
    const idx = selectedContacts.indexOf(id);
    if (idx > -1) selectedContacts.splice(idx, 1);
    else selectedContacts.push(id);
}

function toggleAll(checkbox) {
    selectedContacts = checkbox.checked ? contacts.map(c => c.id) : [];
    document.querySelectorAll('#ctable input[type="checkbox"]').forEach(cb => cb.checked = checkbox.checked);
}

async function searchContacts() {
    const query = document.getElementById('search').value;
    if (!query) {
        renderContacts(contacts);
        return;
    }
    try {
        const res = await fetch(`/api/contacts/search?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        renderContacts(data.contacts);
    } catch (e) {
        console.error('Search failed', e);
    }
}

function showModal(id) {
    document.getElementById(id).classList.add('active');
}

function closeModal() {
    document.querySelectorAll('.modal').forEach(m => m.classList.remove('active'));
}

async function addContact(e) {
    e.preventDefault();
    const data = {
        name: document.getElementById('cname').value,
        phone: document.getElementById('cphone').value,
        email: document.getElementById('cemail').value,
        company: document.getElementById('ccompany').value,
        city: document.getElementById('ccity').value,
        country: document.getElementById('ccountry').value,
        tags: document.getElementById('ctags').value.split(',').map(t => t.trim()).filter(t => t)
    };
    try {
        const res = await fetch('/api/contacts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (res.ok) {
            showMessage('msg1', 'Contact added successfully', 'success');
            closeModal();
            loadContacts();
            e.target.reset();
        } else {
            const err = await res.json();
            showMessage('mcmsg', err.error || 'Failed to add contact', 'error');
        }
    } catch (e) {
        showMessage('mcmsg', 'Error adding contact', 'error');
    }
}

async function deleteContact(id) {
    if (!confirm('Delete this contact?')) return;
    try {
        await fetch(`/api/contacts/${id}`, { method: 'DELETE' });
        loadContacts();
        showMessage('msg1', 'Contact deleted', 'success');
    } catch (e) {
        showMessage('msg1', 'Delete failed', 'error');
    }
}

async function deleteSelected() {
    if (selectedContacts.length === 0) {
        alert('No contacts selected');
        return;
    }
    if (!confirm(`Delete ${selectedContacts.length} contacts?`)) return;
    try {
        await fetch('/api/contacts/delete-bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contactIds: selectedContacts })
        });
        selectedContacts = [];
        loadContacts();
        showMessage('msg1', 'Contacts deleted', 'success');
    } catch (e) {
        showMessage('msg1', 'Delete failed', 'error');
    }
}

async function importCSV() {
    const file = document.getElementById('csv').files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('csvFile', file);
    try {
        const res = await fetch('/api/contacts/import-csv', {
            method: 'POST',
            body: formData
        });
        const data = await res.json();
        showMessage('msg1', data.message || 'Import successful', 'success');
        loadContacts();
    } catch (e) {
        showMessage('msg1', 'Import failed', 'error');
    }
}

// Groups
async function loadGroups() {
    try {
        const res = await fetch('/api/groups');
        const data = await res.json();
        groups = data.groups || [];
        renderGroups();
        updateGroupSelects();
    } catch (e) {
        console.error('Load groups failed', e);
    }
}

function renderGroups() {
    const container = document.getElementById('glist');
    if (groups.length === 0) {
        container.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:60px;color:#999"><h3>No groups yet</h3><p>Create your first group</p></div>';
        return;
    }
    container.innerHTML = groups.map(g => `
        <div class="card">
            <h3>${g.name}</h3>
            <p style="color:#666;font-size:13px;margin:10px 0">${g.description || ''}</p>
            <p style="color:#999;font-size:12px">${g.member_count || 0} members</p>
            <div style="margin-top:15px;display:flex;gap:10px">
                <button onclick="viewGroup(${g.id})" class="btn btn-sm">View</button>
                <button onclick="deleteGroup(${g.id})" class="btn btn-danger btn-sm">Delete</button>
            </div>
        </div>
    `).join('');
}

function updateGroupSelects() {
    const selects = [document.getElementById('grp'), document.getElementById('group-select')];
    selects.forEach(sel => {
        if (!sel) return;
        sel.innerHTML = '<option value="">--Select--</option>' + 
            groups.map(g => `<option value="${g.id}">${g.name}</option>`).join('');
    });
}

async function addGroup(e) {
    e.preventDefault();
    const data = {
        name: document.getElementById('gname').value,
        description: document.getElementById('gdesc').value
    };
    try {
        const res = await fetch('/api/groups', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (res.ok) {
            showMessage('msg2', 'Group created successfully', 'success');
            closeModal();
            loadGroups();
            e.target.reset();
        } else {
            showMessage('mgmsg', 'Failed to create group', 'error');
        }
    } catch (e) {
        showMessage('mgmsg', 'Error creating group', 'error');
    }
}

async function deleteGroup(id) {
    if (!confirm('Delete this group?')) return;
    try {
        await fetch(`/api/groups/${id}`, { method: 'DELETE' });
        loadGroups();
        showMessage('msg2', 'Group deleted', 'success');
    } catch (e) {
        showMessage('msg2', 'Delete failed', 'error');
    }
}

let currentGroupId = null;

async function viewGroup(id) {
    currentGroupId = id;
    try {
        // Load group details
        const groupRes = await fetch(`/api/groups`);
        const groupData = await groupRes.json();
        const group = groupData.groups.find(g => g.id === id);
        
        if (!group) {
            showMessage('msg2', 'Group not found', 'error');
            return;
        }
        
        // Load group members
        const membersRes = await fetch(`/api/groups/${id}/members`);
        const membersData = await membersRes.json();
        const members = membersData.members || [];
        
        // Update modal
        document.getElementById('groupTitle').textContent = group.name;
        document.getElementById('memberCount').textContent = members.length;
        
        // Render members list
        const memberList = document.getElementById('memberList');
        if (members.length === 0) {
            memberList.innerHTML = '<div style="text-align:center;padding:20px;color:#999">No members yet</div>';
        } else {
            memberList.innerHTML = members.map(m => `
                <div style="display:flex;justify-content:space-between;align-items:center;padding:10px;border-bottom:1px solid #f0f0f0">
                    <div>
                        <strong>${m.name}</strong>
                        <div style="font-size:12px;color:#666">${m.phone}</div>
                    </div>
                    <button onclick="removeMemberFromGroup(${id}, ${m.contact_id})" class="btn btn-danger btn-sm">Remove</button>
                </div>
            `).join('');
        }
        
        // Load all contacts for adding
        const contactsRes = await fetch('/api/contacts');
        const contactsData = await contactsRes.json();
        const allContacts = contactsData.contacts || [];
        
        // Filter out contacts that are already members
        const memberIds = members.map(m => m.contact_id);
        const availableContacts = allContacts.filter(c => !memberIds.includes(c.id));
        
        // Render contact checkboxes
        const checkboxContainer = document.getElementById('contactCheckboxes');
        if (availableContacts.length === 0) {
            checkboxContainer.innerHTML = '<div style="color:#999">All contacts are already members</div>';
        } else {
            checkboxContainer.innerHTML = availableContacts.map(c => `
                <label style="display:flex;align-items:center;gap:5px;padding:8px;border:1px solid #e9ecef;border-radius:6px;cursor:pointer">
                    <input type="checkbox" value="${c.id}" class="member-checkbox">
                    <span>${c.name}</span>
                </label>
            `).join('');
        }
        
        showModal('viewGroup');
    } catch (e) {
        console.error('Failed to load group', e);
        showMessage('msg2', 'Failed to load group details', 'error');
    }
}

async function addMembersToGroup() {
    const checkboxes = document.querySelectorAll('.member-checkbox:checked');
    const contactIds = Array.from(checkboxes).map(cb => parseInt(cb.value));
    
    if (contactIds.length === 0) {
        showMessage('gmsg', 'Please select at least one contact', 'error');
        return;
    }
    
    try {
        const res = await fetch(`/api/groups/${currentGroupId}/members`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contactIds })
        });
        
        if (res.ok) {
            showMessage('gmsg', `Added ${contactIds.length} member(s) successfully`, 'success');
            // Reload the group view
            setTimeout(() => viewGroup(currentGroupId), 1000);
        } else {
            showMessage('gmsg', 'Failed to add members', 'error');
        }
    } catch (e) {
        showMessage('gmsg', 'Error adding members', 'error');
    }
}

async function removeMemberFromGroup(groupId, contactId) {
    if (!confirm('Remove this member from the group?')) return;
    
    try {
        const res = await fetch(`/api/groups/${groupId}/members`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contactIds: [contactId] })
        });
        
        if (res.ok) {
            showMessage('gmsg', 'Member removed successfully', 'success');
            // Reload the group view
            setTimeout(() => viewGroup(groupId), 1000);
        } else {
            showMessage('gmsg', 'Failed to remove member', 'error');
        }
    } catch (e) {
        showMessage('gmsg', 'Error removing member', 'error');
    }
}

// Templates
async function loadTemplates() {
    try {
        const res = await fetch('/api/templates');
        const data = await res.json();
        templates = data.templates || [];
        renderTemplates();
        updateTemplateSelect();
    } catch (e) {
        console.error('Load templates failed', e);
    }
}

function renderTemplates() {
    const container = document.getElementById('tlist');
    if (templates.length === 0) {
        container.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:60px;color:#999"><h3>No templates yet</h3><p>Create your first message template</p></div>';
        return;
    }
    container.innerHTML = templates.map(t => `
        <div class="card">
            <h3>${t.name}</h3>
            <p style="color:#999;font-size:12px;margin:5px 0">${t.category || 'General'} • ${t.language || 'en'}</p>
            <p style="color:#666;font-size:13px;margin:10px 0;max-height:60px;overflow:hidden">${t.content}</p>
            <div style="margin-top:15px;display:flex;gap:10px">
                <button onclick="useTemplate(${t.id})" class="btn btn-sm">Use</button>
                <button onclick="deleteTemplate(${t.id})" class="btn btn-danger btn-sm">Delete</button>
            </div>
        </div>
    `).join('');
}

function updateTemplateSelect() {
    const sel = document.getElementById('tpl');
    sel.innerHTML = '<option value="">--Select--</option>' + 
        templates.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
}

async function addTemplate(e) {
    e.preventDefault();
    const data = {
        name: document.getElementById('tname').value,
        category: document.getElementById('tcat').value,
        language: document.getElementById('tlang').value,
        content: document.getElementById('tcontent').value
    };
    try {
        const res = await fetch('/api/templates', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (res.ok) {
            showMessage('msg3', 'Template created successfully', 'success');
            closeModal();
            loadTemplates();
            e.target.reset();
        } else {
            showMessage('mtmsg', 'Failed to create template', 'error');
        }
    } catch (e) {
        showMessage('mtmsg', 'Error creating template', 'error');
    }
}

async function deleteTemplate(id) {
    if (!confirm('Delete this template?')) return;
    try {
        await fetch(`/api/templates/${id}`, { method: 'DELETE' });
        loadTemplates();
        showMessage('msg3', 'Template deleted', 'success');
    } catch (e) {
        showMessage('msg3', 'Delete failed', 'error');
    }
}

function useTemplate(id) {
    switchTab(4);
    document.getElementById('tpl').value = id;
    loadTpl();
}

function loadTpl() {
    const id = document.getElementById('tpl').value;
    if (!id) return;
    const tpl = templates.find(t => t.id == id);
    if (tpl) document.getElementById('msg').value = tpl.content;
}

// Send Messages
function updateRecipients() {
    const type = document.getElementById('rectype').value;
    document.getElementById('gsel').style.display = type === 'group' ? 'block' : 'none';
}

async function send() {
    const type = document.getElementById('rectype').value;
    const message = document.getElementById('msg').value;
    
    if (!message) {
        alert('Please enter a message');
        return;
    }
    
    let recipients = [];
    if (type === 'all') {
        recipients = contacts;
    } else if (type === 'selected') {
        recipients = contacts.filter(c => selectedContacts.includes(c.id));
    } else if (type === 'group') {
        const groupId = document.getElementById('grp').value;
        if (!groupId) {
            alert('Please select a group');
            return;
        }
        try {
            const res = await fetch(`/api/groups/${groupId}/members`);
            const data = await res.json();
            recipients = data.members || [];
        } catch (e) {
            showMessage('msg4', 'Failed to load group members', 'error');
            return;
        }
    }
    
    if (recipients.length === 0) {
        alert('No recipients selected');
        return;
    }
    
    if (!confirm(`Send message to ${recipients.length} contacts?`)) return;
    
    showMessage('msg4', `Sending messages to ${recipients.length} contacts...`, 'info');
    
    try {
        const res = await fetch('/api/send-messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contacts: recipients, message })
        });
        const data = await res.json();
        showMessage('msg4', data.message || 'Messages sent successfully', 'success');
        loadHistory();
        loadStats();
    } catch (e) {
        showMessage('msg4', 'Failed to send messages', 'error');
    }
}

// History
async function loadHistory() {
    try {
        const res = await fetch('/api/history?limit=50');
        const data = await res.json();
        const tbody = document.getElementById('htable');
        if (!data.history || data.history.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:40px">No history</td></tr>';
            return;
        }
        tbody.innerHTML = data.history.map(h => `
            <tr>
                <td>${new Date(h.sent_at).toLocaleString()}</td>
                <td>${h.contact_name || '-'}</td>
                <td>${h.phone}</td>
                <td><span class="badge ${h.status === 'sent' ? 'conn' : 'disc'}">${h.status}</span></td>
                <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${h.message}</td>
            </tr>
        `).join('');
    } catch (e) {
        console.error('Load history failed', e);
    }
}

async function loadStats() {
    try {
        const res = await fetch('/api/history/stats');
        const data = await res.json();
        document.getElementById('st1').textContent = data.allTime?.total_messages || 0;
        document.getElementById('st2').textContent = data.allTime?.sent_messages || 0;
        document.getElementById('st3').textContent = data.allTime?.failed_messages || 0;
        document.getElementById('st4').textContent = data.today?.total_messages || 0;
    } catch (e) {
        console.error('Load stats failed', e);
    }
}

// Utility
function showMessage(id, msg, type) {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = `<div style="padding:12px;border-radius:8px;margin:10px 0;background:${type === 'success' ? '#d4edda' : type === 'error' ? '#f8d7da' : '#fff3cd'};color:${type === 'success' ? '#155724' : type === 'error' ? '#721c24' : '#856404'}">${msg}</div>`;
    setTimeout(() => el.innerHTML = '', 5000);
}

// Close modal on outside click
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal')) {
        closeModal();
    }
});

// ============= ERROR LOGS =============

async function loadErrors() {
    try {
        const res = await fetch('/api/errors');
        const data = await res.json();
        const tbody = document.getElementById('etable');
        
        if (data.errors.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:40px">No errors</td></tr>';
        } else {
            tbody.innerHTML = data.errors.map(err => `
                <tr class="${err.resolved ? 'error-resolved' : ''}">
                    <td>${new Date(err.created_at).toLocaleString()}</td>
                    <td>${err.error_type}</td>
                    <td><span class="severity-${err.severity}">${err.severity}</span></td>
                    <td title="${err.stack_trace || ''}">${err.error_message}</td>
                    <td>
                        ${!err.resolved ? `<button onclick="resolveError(${err.id})" class="btn btn-sm btn-success">Resolve</button>` : ''}
                        <button onclick="deleteError(${err.id})" class="btn btn-sm btn-danger">Delete</button>
                        ${err.context ? `<button onclick="viewErrorDetails(${err.id})" class="btn btn-sm btn-secondary">Details</button>` : ''}
                    </td>
                </tr>
            `).join('');
        }
    } catch (e) {
        console.error('Load errors failed', e);
    }
}

async function loadErrorStats() {
    try {
        const res = await fetch('/api/errors/stats');
        const data = await res.json();
        
        document.getElementById('est1').textContent = data.unresolved || 0;
        document.getElementById('est2').textContent = data.critical || 0;
        document.getElementById('est3').textContent = data.error || 0;
        document.getElementById('est4').textContent = data.warning || 0;
        document.getElementById('ecount').textContent = data.unresolved || 0;
        
        // Update badge class
        const badge = document.getElementById('ecount');
        if (data.critical > 0) {
            badge.className = 'badge disc';
        } else if (data.error > 0) {
            badge.className = 'badge connecting';
        } else if (data.warning > 0) {
            badge.className = 'badge conn';
        } else {
            badge.className = 'badge';
        }
    } catch (e) {
        console.error('Load error stats failed', e);
    }
}

async function resolveError(id) {
    try {
        const res = await fetch(`/api/errors/${id}/resolve`, { method: 'PATCH' });
        if (res.ok) {
            showMessage('msg6', 'Error marked as resolved', 'success');
            loadErrors();
            loadErrorStats();
        } else {
            showMessage('msg6', 'Failed to resolve error', 'error');
        }
    } catch (e) {
        showMessage('msg6', 'Failed to resolve error', 'error');
    }
}

async function deleteError(id) {
    if (!confirm('Delete this error log?')) return;
    
    try {
        const res = await fetch(`/api/errors/${id}`, { method: 'DELETE' });
        if (res.ok) {
            showMessage('msg6', 'Error deleted', 'success');
            loadErrors();
            loadErrorStats();
        } else {
            showMessage('msg6', 'Failed to delete error', 'error');
        }
    } catch (e) {
        showMessage('msg6', 'Failed to delete error', 'error');
    }
}

async function resolveAllErrors() {
    if (!confirm('Mark all errors as resolved?')) return;
    
    try {
        const res = await fetch('/api/errors/resolve-all', { method: 'POST' });
        const data = await res.json();
        if (res.ok) {
            showMessage('msg6', data.message, 'success');
            loadErrors();
            loadErrorStats();
        } else {
            showMessage('msg6', 'Failed to resolve all errors', 'error');
        }
    } catch (e) {
        showMessage('msg6', 'Failed to resolve all errors', 'error');
    }
}

async function clearResolvedErrors() {
    if (!confirm('Delete all resolved errors? This cannot be undone.')) return;
    
    try {
        const res = await fetch('/api/errors/clear-resolved', { method: 'DELETE' });
        const data = await res.json();
        if (res.ok) {
            showMessage('msg6', data.message, 'success');
            loadErrors();
            loadErrorStats();
        } else {
            showMessage('msg6', 'Failed to clear resolved errors', 'error');
        }
    } catch (e) {
        showMessage('msg6', 'Failed to clear resolved errors', 'error');
    }
}

async function viewErrorDetails(id) {
    try {
        const res = await fetch(`/api/errors/${id}`);
        const err = await res.json();
        
        let details = `Error ID: ${err.id}\n`;
        details += `Type: ${err.error_type}\n`;
        details += `Severity: ${err.severity}\n`;
        details += `Time: ${new Date(err.created_at).toLocaleString()}\n`;
        details += `Message: ${err.error_message}\n\n`;
        
        if (err.context) {
            details += `Context:\n${JSON.stringify(err.context, null, 2)}\n\n`;
        }
        
        if (err.stack_trace) {
            details += `Stack Trace:\n${err.stack_trace}`;
        }
        
        alert(details);
    } catch (e) {
        showMessage('msg6', 'Failed to load error details', 'error');
    }
}

// Mobile sidebar toggle
function toggleSidebar() {
    const sidebar = document.querySelector('.sidebar');
    sidebar.classList.toggle('open');
}

