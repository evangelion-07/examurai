const grid = document.querySelector('#paperGrid');
const searchInput = document.querySelector('#searchInput');
const branchFilter = document.querySelector('#branchFilter');
let papers = [];
let activeFilter = 'all';

document.querySelector('#year').textContent = new Date().getFullYear();

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function renderPapers() {
  const query = searchInput.value.trim().toLowerCase();
  const visible = papers.filter(paper => {
    const content = [paper.subject, paper.name, paper.college, paper.course, paper.semester].join(' ').toLowerCase();
    return (!query || content.includes(query)) && (!branchFilter.value || paper.course === branchFilter.value);
  });

  if (!visible.length) {
    grid.innerHTML = '<div class="empty-state"><p>No papers match this search yet. Try another subject or branch.</p></div>';
    return;
  }

  grid.innerHTML = visible.map(paper => `
    <article class="paper-card">
      <div class="card-top"><span class="subject-tag">${escapeHtml(paper.subject || 'Question paper')}</span><button class="bookmark" data-id="${escapeHtml(paper.id)}" aria-label="Sign in to bookmark">♡</button></div>
      <h3>${escapeHtml(paper.name || paper.original_name || paper.subject || 'Examination paper')}</h3>
      <p>${escapeHtml(paper.college || 'Student contribution')}</p>
      <div class="card-meta"><span>${escapeHtml(paper.course || 'Engineering')}</span><span>${escapeHtml(paper.semester || 'Semester')}</span><span>${paper.year ? escapeHtml(paper.year) : 'Past paper'}</span></div>
      <div class="card-actions"><a href="/api/download/${encodeURIComponent(paper.id)}" class="download-link">Get this paper →</a><span>PDF document</span></div>
    </article>`).join('');

  grid.querySelectorAll('.bookmark').forEach(button => button.addEventListener('click', () => {
    const token = localStorage.getItem('examurai-token');
    if (!token) return showSignin();
  }));
}

function showSignin() {
  document.querySelector('#uploadDialog').showModal();
}

async function loadLibrary() {
  try {
    const response = await fetch('/api/papers');
    if (!response.ok) throw new Error('Library is unavailable');
    const result = await response.json();
    papers = Array.isArray(result) ? result : result.papers || [];
    document.querySelector('#paperCount').textContent = result.total ?? papers.length;
    const subjects = new Set(papers.map(paper => paper.subject).filter(Boolean));
    const colleges = new Set(papers.map(paper => paper.college).filter(Boolean));
    document.querySelector('#subjectCount').textContent = subjects.size;
    document.querySelector('#collegeCount').textContent = colleges.size;
    const branches = [...new Set(papers.map(paper => paper.course).filter(Boolean))].sort();
    branchFilter.innerHTML = '<option value="">All branches</option>' + branches.map(branch => `<option value="${escapeHtml(branch)}">${escapeHtml(branch)}</option>`).join('');
    document.querySelector('#libraryNote').textContent = papers.length ? 'Browse, search, and download papers shared by the community.' : 'The library is ready for its first contributions.';
    renderPapers();
  } catch {
    grid.innerHTML = '<div class="empty-state"><p>Paper library is offline. Start the server and connect the database to load papers.</p></div>';
    document.querySelector('#libraryNote').textContent = 'Connect the configured database to explore the question paper collection.';
  }
}

document.querySelector('#searchForm').addEventListener('submit', event => { event.preventDefault(); renderPapers(); document.querySelector('#papers').scrollIntoView({ behavior: 'smooth' }); });
searchInput.addEventListener('input', renderPapers);
branchFilter.addEventListener('change', renderPapers);
document.querySelectorAll('.filter').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('.filter').forEach(item => item.classList.remove('active'));
  button.classList.add('active');
  activeFilter = button.dataset.filter;
  if (activeFilter === 'recent') papers.sort((a, b) => new Date(b.uploaded_at || 0) - new Date(a.uploaded_at || 0));
  if (activeFilter === 'popular') papers.sort((a, b) => (b.bookmark_count || 0) - (a.bookmark_count || 0));
  renderPapers();
}));
document.querySelector('#signin').addEventListener('click', showSignin);
document.querySelector('#uploadTop').addEventListener('click', showSignin);
document.querySelector('#uploadCta').addEventListener('click', showSignin);
document.querySelector('#dialogSignin').addEventListener('click', () => { document.querySelector('#uploadDialog').close(); window.location.href = '/pages/signin.html'; });
document.querySelector('.dialog-close').addEventListener('click', () => document.querySelector('#uploadDialog').close());
document.querySelector('.menu-toggle').addEventListener('click', () => document.querySelector('#papers').scrollIntoView({ behavior: 'smooth' }));
loadLibrary();
