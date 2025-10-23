// script.js
const API_URL = '/api';
let pointsBarChart = null; // Chart instance for bar chart

document.addEventListener('DOMContentLoaded', async () => {

    // --- Check login status on page load ---
    try {
        const authResponse = await fetch(`${API_URL}/auth/status`);
        if (!authResponse.ok) throw new Error('Auth check failed');
        const authResult = await authResponse.json();

        if (authResult.loggedIn) {
            document.getElementById('loggedInUsername').textContent = authResult.username;
        } else {
            // If not logged in and not already on login page, redirect
            if (!window.location.pathname.endsWith('login.html')) {
                window.location.href = '/Login';
                return; // Stop further execution if redirecting
            }
        }
    } catch (error) {
        console.error("Authentication check failed:", error);
         // Redirect to login if auth check fails catastrophically
        if (!window.location.pathname.endsWith('login.html')) {
             window.location.href = '/Login';
             return; // Stop further execution
        }
    }
    // --- End of Auth Check ---

    // --- Logout Button Logic ---
    const logoutButton = document.getElementById('logoutButton');
    if (logoutButton) {
        logoutButton.addEventListener('click', async () => {
            try {
                const response = await fetch(`${API_URL}/logout`, { method: 'POST' });
                const result = await response.json();
                if (response.ok && result.success) {
                    window.location.href = '/Login'; // Redirect to login page
                } else {
                    alert('Logout failed: ' + (result.message || 'Unknown error'));
                }
            } catch (error) {
                console.error('Logout request failed:', error);
                alert('An error occurred during logout.');
            }
        });
    }
    // --- End of Logout Logic ---

    // --- showAlert function for auto-dismiss ---
    function showAlert(paneId, message, isSuccess, autoDismiss = false) {
        const placeholder = document.querySelector(`#${paneId} .alert-placeholder`);
        if (!placeholder) return;

        const alertType = isSuccess ? 'success' : 'danger';
        const alertHTML = `
            <div class="alert alert-${alertType} alert-dismissible fade show" role="alert">
                ${message}
                <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
            </div>
        `;
        placeholder.innerHTML = alertHTML; // Replace existing alert

        // Auto-dismiss logic
        if (!isSuccess && autoDismiss) {
            setTimeout(() => {
                const errorAlert = placeholder.querySelector('.alert-danger');
                if (errorAlert) {
                    bootstrap.Alert.getOrCreateInstance(errorAlert).close();
                }
            }, 3000); // 3 seconds
        }
    }

    // --- Logic to hide offcanvas on link click ---
    const sidebarElement = document.getElementById('sidebar');
    const sidebar = new bootstrap.Offcanvas(sidebarElement);

    document.querySelectorAll('#sidebar .nav-link').forEach(link => {
        link.addEventListener('click', () => {
            // Don't hide for the backup link which navigates away
            if (!link.href || link.getAttribute('href').startsWith('#') || link.hasAttribute('data-bs-toggle')) {
                 sidebar.hide();
            }
        });
    });

    // --- Dashboard Logic ---
    async function loadDashboardData() {
        try {
            const response = await fetch(`${API_URL}/summary`);
            if (!response.ok) throw new Error('Failed to load summary data.');
            const result = await response.json();

            if (result.success) {
                // Populate Stat Cards
                document.getElementById('stat-total-candidates').textContent = result.stats.totalCandidates;
                document.getElementById('stat-total-points').textContent = result.stats.totalPoints;
                document.getElementById('stat-total-attendance').textContent = result.stats.totalAttendance;

                // Render Bar Chart
                renderBarChart(result.charts.pointsPerDay);

                // Render Top 3 Users
                const topUsersList = document.getElementById('top-users-list');
                topUsersList.innerHTML = ''; // Clear previous
                if (result.charts.topUsers.length === 0) {
                    topUsersList.innerHTML = '<li class="list-group-item text-muted">No users found.</li>';
                }
                result.charts.topUsers.forEach(user => {
                    topUsersList.innerHTML += `
                        <li class="list-group-item">
                            <div>
                                <span class="user-name">${user.name}</span>
                                <span class="user-uid">UID: ${user.uid}</span>
                            </div>
                            <span class="user-points">${user.total} pts</span>
                        </li>
                    `;
                });

                // Populate Activity Feed
                const feedElement = document.getElementById('activity-feed');
                feedElement.innerHTML = ''; // Clear previous
                if (result.feed.length === 0) {
                    feedElement.innerHTML = '<li class="list-group-item text-muted">No recent activity.</li>';
                }
                result.feed.forEach(item => {
                    feedElement.innerHTML += `
                        <li class="list-group-item d-flex justify-content-between align-items-center">
                            <div>
                                <span class="activity-name">${item.name}</span>
                                <span class="activity-reason d-block">${item.reason}</span>
                            </div>
                            <span class="activity-points">${item.points > 0 ? '+' : ''}${item.points}</span>
                        </li>
                    `;
                });
            } else {
                 console.error('API Error fetching dashboard data:', result.message);
            }
        } catch (error) {
            console.error('Error loading dashboard:', error);
             // Optionally show an alert on the dashboard itself
             showAlert('dashboard', 'Could not load dashboard data. Please refresh.', false);
        }
    }

    function renderBarChart(data) {
        const ctx = document.getElementById('pointsBarChart').getContext('2d');
        const labels = data.map(d => new Date(d.date + 'T00:00:00').toLocaleDateString()); // Ensure correct date parsing
        const values = data.map(d => d.total);
        if (pointsBarChart) pointsBarChart.destroy(); // Clear old chart before drawing new
        pointsBarChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Points Awarded',
                    data: values,
                    backgroundColor: 'rgba(88, 86, 214, 0.7)', // Primary color with opacity
                    borderColor: 'rgba(88, 86, 214, 1)',
                    borderWidth: 1,
                    borderRadius: 5
                }]
            },
            options: {
                 responsive: true,
                 maintainAspectRatio: false, // Allow chart to fill container height
                 scales: { y: { beginAtZero: true } },
                 plugins: { legend: { display: false } } // Hide legend if not needed
            }
        });
    }

    // Load dashboard when tab is shown
    const dashboardTab = document.getElementById('dashboard-tab');
    if (dashboardTab) {
        dashboardTab.addEventListener('show.bs.tab', loadDashboardData);
        // Also load initially if it's the active tab
        if (dashboardTab.classList.contains('active')) {
             loadDashboardData();
        }
    }

    // --- Form Handlers ---

    // 1. Create Candidate
    document.getElementById('createCandidateForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const paneId = 'create-candidate';
        const candidateData = { name: document.getElementById('name').value, age: document.getElementById('age').value, phone: document.getElementById('phone').value, gender: document.getElementById('gender').value };
        try {
            const response = await fetch(`${API_URL}/candidates`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(candidateData) });
            const result = await response.json();
            if (!response.ok) throw new Error(result.message || `HTTP error! status: ${response.status}`);
            showAlert(paneId, `Candidate created with UID: ${result.uid}`, true);
            e.target.reset();
        } catch (error) {
            showAlert(paneId, error.message, false, true); // auto-dismiss
        }
    });

    // 2. View Candidate
    document.getElementById('viewCandidateForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const paneId = 'view-candidate';
        const searchTerm = document.getElementById('searchTerm').value;
        const detailsDiv = document.getElementById('candidateDetails');
        detailsDiv.innerHTML = '<div class="text-center"><div class="spinner-border text-primary" role="status"><span class="visually-hidden">Loading...</span></div></div>'; // Loading indicator
        try {
            const response = await fetch(`${API_URL}/candidates?searchTerm=${encodeURIComponent(searchTerm)}`); // Encode search term
            const result = await response.json();
            if (!response.ok) throw new Error(result.message || `HTTP error! status: ${response.status}`);

            const data = result.data;
            const attendanceBadges = data.attendance.length > 0 ? data.attendance.map(d => `<span class="badge bg-secondary me-1">Day ${d}</span>`).join(' ') : '<span class="text-muted">None</span>';
            const logRows = data.logs.length > 0 ? data.logs.map(log => `
                    <tr>
                        <td>${new Date(log.awarded_at).toLocaleString()}</td>
                        <td>${log.reason}</td>
                        <td>${log.admin_username || '<i class="text-muted">N/A</i>'}</td>
                        <td class="text-end">${log.points > 0 ? '+' : ''}${log.points}</td>
                    </tr>`).join('') : '<tr><td colspan="4" class="text-center text-muted">No point history.</td></tr>';

            detailsDiv.innerHTML = `
                <div class="row">
                    <div class="col-lg-5 mb-3 mb-lg-0">
                        <div class="card shadow-sm border-0">
                            <div class="card-header bg-dark text-white"><h4 class="mb-0">${data.name}</h4><span class="fs-6">UID: ${data.uid}</span></div>
                            <div class="card-body">
                                <p><strong><i class="bi bi-person me-2"></i>Age:</strong> ${data.age}</p>
                                <p><strong><i class="bi bi-phone me-2"></i>Phone:</strong> ${data.phone}</p>
                                <p><strong><i class="bi bi-gender-ambiguous me-2"></i>Gender:</strong> ${data.gender}</p><hr>
                                <p class="mb-2"><strong><i class="bi bi-calendar-check me-2"></i>Attendance:</strong></p><p>${attendanceBadges}</p><hr>
                                <h3 class="text-center">Total Points: <span class="badge bg-primary fs-3">${data.total_points}</span></h3><hr>
                                <button class="btn btn-outline-danger w-100" id="deleteCandidateBtn" data-uid="${data.uid}"><i class="bi bi-trash-fill me-2"></i>Delete Candidate</button>
                            </div>
                        </div>
                    </div>
                    <div class="col-lg-7">
                        <h4 class="mb-3">Point History</h4>
                        <div class="card shadow-sm border-0">
                            <div class="log-table-container table-responsive">
                                <table class="table table-striped table-hover mb-0">
                                    <thead class="table-light" style="position: sticky; top: 0;"><tr><th>Date & Time</th><th>Reason</th><th>Admin</th><th class="text-end">Points</th></tr></thead>
                                    <tbody>${logRows}</tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>`;

            document.getElementById('deleteCandidateBtn').addEventListener('click', async (btnEvent) => {
                const uid = btnEvent.currentTarget.dataset.uid;
                if (!confirm(`Are you sure you want to delete candidate ${uid}? This action cannot be undone.`)) return;
                try {
                    const deleteResponse = await fetch(`${API_URL}/candidates/${uid}`, { method: 'DELETE' });
                    const deleteResult = await deleteResponse.json();
                    if (!deleteResponse.ok) throw new Error(deleteResult.message || `HTTP error! status: ${deleteResponse.status}`);
                    showAlert(paneId, deleteResult.message, true);
                    detailsDiv.innerHTML = ''; // Clear details on success
                } catch (error) {
                    showAlert(paneId, error.message, false, true); // auto-dismiss delete errors
                }
            });
        } catch (error) {
            detailsDiv.innerHTML = ''; // Clear loading indicator
            showAlert(paneId, error.message, false, true); // auto-dismiss view errors
        }
    });

    // 3. Add Points Manually
    document.getElementById('addPointsForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const paneId = 'add-points';
        const data = { uid: document.getElementById('addPointsUid').value, points: document.getElementById('points').value, reason: document.getElementById('reason').value };
        try {
            const response = await fetch(`${API_URL}/points`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
            const result = await response.json();
             if (!response.ok) throw new Error(result.message || `HTTP error! status: ${response.status}`);
            showAlert(paneId, 'Points added successfully.', true);
            e.target.reset();
        } catch (error) {
            showAlert(paneId, error.message, false, true); // auto-dismiss
        }
    });

    // 4. Add Points for Event (Bulk)
    document.getElementById('eventPointsForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const paneId = 'event-points';
        const data = { eventName: document.getElementById('eventName').value, points: document.getElementById('eventPoints').value, uids: document.getElementById('eventUids').value };
        try {
            const response = await fetch(`${API_URL}/event-points`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
            const result = await response.json();
             if (!response.ok && response.status !== 200) throw new Error(result.message || `HTTP error! status: ${response.status}`); // Allow 200 even if success:false
            // NO auto-dismiss for bulk results (success or partial failure)
            showAlert(paneId, result.message, result.success);
            if (result.success) e.target.reset();
        } catch(error) {
             showAlert(paneId, `Error processing bulk points: ${error.message}`, false); // Show error, don't auto-dismiss
        }
    });

    // 5. Mark Attendance (Single)
    document.getElementById('attendanceForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const paneId = 'attendance';
        const data = { uid: document.getElementById('attendanceUid').value, day: document.getElementById('eventDay').value };
        try {
            const response = await fetch(`${API_URL}/attendance`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
            const result = await response.json();
            if (!response.ok) throw new Error(result.message || `HTTP error! status: ${response.status}`);
            showAlert(paneId, result.message, true);
            e.target.reset();
        } catch (error) {
            showAlert(paneId, error.message, false, true); // auto-dismiss
        }
    });

    // 6. Mark Bulk Attendance
    document.getElementById('bulkAttendanceForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const paneId = 'bulk-attendance';
        const data = { day: document.getElementById('bulkEventDay').value, uids: document.getElementById('bulkEventUids').value };
         try {
            const response = await fetch(`${API_URL}/attendance/bulk`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
            const result = await response.json();
             if (!response.ok && response.status !== 200) throw new Error(result.message || `HTTP error! status: ${response.status}`);
            // NO auto-dismiss for bulk results
            showAlert(paneId, result.message, result.success);
            if (result.success) e.target.reset();
         } catch(error) {
             showAlert(paneId, `Error processing bulk attendance: ${error.message}`, false); // Don't auto-dismiss
         }
    });

    // 7. "All Candidates" Tab Logic
    let allCandidatesData = [];
    async function loadAllCandidates() {
        const bodyElement = document.getElementById('allCandidatesBody');
        bodyElement.innerHTML = '<tr><td colspan="6" class="text-center"><div class="spinner-border spinner-border-sm text-primary" role="status"><span class="visually-hidden">Loading...</span></div></td></tr>';
        try {
            const response = await fetch(`${API_URL}/candidates/all`);
            const result = await response.json();
             if (!response.ok) throw new Error(result.message || `HTTP error! status: ${response.status}`);
            if (result.success) {
                allCandidatesData = result.data;
                applyFiltersAndSort(); // Initial render
            } else {
                 bodyElement.innerHTML = `<tr><td colspan="6" class="text-center text-danger">Error: ${result.message}</td></tr>`;
            }
        } catch (error) {
             bodyElement.innerHTML = `<tr><td colspan="6" class="text-center text-danger">Failed to load candidates: ${error.message}</td></tr>`;
        }
    }

    function applyFiltersAndSort() {
        let filteredData = [...allCandidatesData];
        const gender = document.getElementById('filterGender').value;
        const sortBy = document.getElementById('filterSort').value;
        const search = document.getElementById('filterSearch').value.toLowerCase();
        // Filter
        if (gender !== 'all') { filteredData = filteredData.filter(c => c.gender === gender); }
        if (search) { filteredData = filteredData.filter(c => c.name.toLowerCase().includes(search) || c.uid.toString().includes(search)); }
        // Sort
        filteredData.sort((a, b) => {
            if (sortBy === 'name') return a.name.localeCompare(b.name);
            if (sortBy === 'total_points') return b.total_points - a.total_points;
            if (sortBy === 'today_points') return b.today_points - a.today_points;
            return a.uid - b.uid; // Default sort by UID
        });
        renderAllCandidates(filteredData);
    }

    function renderAllCandidates(candidates) {
        const allCandidatesBody = document.getElementById('allCandidatesBody');
        allCandidatesBody.innerHTML = ''; // Clear
        if (candidates.length > 0) {
            candidates.forEach(c => {
                allCandidatesBody.innerHTML += `<tr><th scope="row">${c.uid}</th><td>${c.name}</td><td>${c.phone || '-'}</td><td>${c.gender}</td><td>${c.today_points}</td><td>${c.total_points}</td></tr>`;
            });
        } else {
            allCandidatesBody.innerHTML = '<tr><td colspan="6" class="text-center">No candidates match filters.</td></tr>';
        }
    }
    // Add event listeners for filters
    document.getElementById('filterGender').addEventListener('change', applyFiltersAndSort);
    document.getElementById('filterSort').addEventListener('change', applyFiltersAndSort);
    document.getElementById('filterSearch').addEventListener('input', applyFiltersAndSort); // Use 'input' for instant search

    // Load data when tab is shown
    const allCandidatesTab = document.getElementById('all-candidates-tab');
    if (allCandidatesTab) {
        allCandidatesTab.addEventListener('show.bs.tab', () => loadAllCandidates());
    }

}); // End DOMContentLoaded