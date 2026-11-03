const $ = (selector) => document.querySelector(selector);

let currentUser = null;
let mods = [];
let tools = [];

const modalBackdrop = $("#modalBackdrop");
const modalContent = $("#modalContent");

// API REQUESTS

async function api(url, options = {}) {
    const response = await fetch(url, {
        credentials: "same-origin",
        ...options
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.error || "Something went wrong.");
    }

    return data;
}

// HELPERS

function escapeHTML(value = "") {
    return String(value).replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
    })[char]);
}

function showToast(message) {
    const toast = $("#toast");
    if (!toast) return;

    toast.textContent = message;
    toast.classList.add("show");

    setTimeout(() => toast.classList.remove("show"), 3000);
}

// MODAL

function openModal(content) {
    if (!modalBackdrop || !modalContent) return;

    modalContent.innerHTML = content;
    modalBackdrop.classList.add("open");
}

function closeModal() {
    modalBackdrop?.classList.remove("open");
}

$("#modalClose")?.addEventListener("click", closeModal);

modalBackdrop?.addEventListener("click", event => {
    if (event.target === modalBackdrop) closeModal();
});

document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeModal();
});

// LOGIN

function loginModal() {
    openModal(`
        <div class="modal-heading">
            <h2>Owner Login</h2>
            <p>Sign in to manage PENG.LOL.</p>
        </div>

        <form id="loginForm">
            <div class="field">
                <label>Username</label>
                <input name="username" placeholder="Username" required>
            </div>

            <div class="field">
                <label>Password</label>
                <input name="password" type="password"
                    placeholder="Password" required>
            </div>

            <button class="form-submit" type="submit">
                Login
            </button>
        </form>
    `);

    $("#loginForm").addEventListener("submit", handleLogin);
}

$("#loginOpen")?.addEventListener("click", loginModal);

async function handleLogin(event) {
    event.preventDefault();

    const form = new FormData(event.target);

    try {
        await api("/api/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                username: form.get("username"),
                password: form.get("password")
            })
        });

        await loadAccount();
        closeModal();
        await loadMods();
        await loadTools();
        showToast("Welcome back!");
    } catch (error) {
        showToast(error.message);
    }
}

// ACCOUNT

async function loadAccount() {
    try {
        const data = await api("/api/me");
        currentUser = data.user;

        const loginButton = $("#loginOpen");
        const accountButton = $("#accountBtn");

        if (currentUser) {
            if (loginButton) loginButton.style.display = "none";

            if (accountButton) {
                accountButton.style.display = "inline-flex";
                accountButton.textContent = "Owner Panel";
            }
        } else {
            if (loginButton) loginButton.style.display = "";

            if (accountButton) {
                accountButton.style.display = "none";
            }
        }
    } catch {
        currentUser = null;
    }
}

// OWNER PANEL

$("#accountBtn")?.addEventListener("click", ownerPanel);

function ownerPanel() {
    if (!currentUser) {
        loginModal();
        return;
    }

    openModal(`
        <div class="modal-heading">
            <h2>Owner Panel</h2>
            <p>Manage your PENG.LOL website.</p>
        </div>

        <div class="owner-actions">
            <button class="form-submit" id="addModButton">
                Add a Mod
            </button>

            <button class="form-submit" id="addToolButton">
                Add a Tool
            </button>

            <button class="small-btn" id="logoutButton">
                Logout
            </button>
        </div>
    `);

    $("#addModButton").onclick = addModModal;
    $("#addToolButton").onclick = addToolModal;
    $("#logoutButton").onclick = logout;
}

async function logout() {
    try {
        await api("/api/logout", { method: "POST" });

        currentUser = null;
        await loadAccount();
        await loadMods();
        await loadTools();

        closeModal();
        showToast("Logged out.");
    } catch (error) {
        showToast(error.message);
    }
}

// ADD / EDIT MODS

function addModModal(mod = null) {
    if (!currentUser) return;

    const editing = Boolean(mod);

    openModal(`
        <div class="modal-heading">
            <h2>${editing ? "Edit Mod" : "Add a Mod"}</h2>
            <p>${editing ? "Update your mod." : "Publish a new mod on PENG.LOL."}</p>
        </div>

        <form id="modForm">
            <div class="field">
                <label>Mod Name</label>
                <input name="name" required
                    value="${escapeHTML(mod?.name || "")}"
                    placeholder="My Awesome Mod">
            </div>

            <div class="field">
                <label>Game</label>
                <input name="game"
                    value="${escapeHTML(mod?.game || "")}"
                    placeholder="Game name">
            </div>

            <div class="field">
                <label>Description</label>
                <textarea name="description" required
                    placeholder="Describe your mod...">${escapeHTML(mod?.description || "")}</textarea>
            </div>

            <div class="field">
                <label>Download URL</label>
                <input name="download_url" type="url" required
                    value="${escapeHTML(mod?.download_url || "")}"
                    placeholder="https://...">
            </div>

            <div class="field">
                <label>Mod Image</label>
                <input name="image" type="file" accept="image/*">
            </div>

            <button class="form-submit" type="submit">
                ${editing ? "Save Changes" : "Publish Mod"}
            </button>
        </form>
    `);

    $("#modForm").onsubmit = async event => {
        event.preventDefault();

        const formData = new FormData(event.target);

        try {
            await api(
                editing ? `/api/mods/${mod.id}` : "/api/mods",
                {
                    method: editing ? "PUT" : "POST",
                    body: formData
                }
            );

            closeModal();
            await loadMods();

            showToast(editing ? "Mod updated!" : "Mod published!");
        } catch (error) {
            showToast(error.message);
        }
    };
}

// ADD TOOLS

function addToolModal() {
    if (!currentUser) return;

    openModal(`
        <div class="modal-heading">
            <h2>Add a Tool</h2>
            <p>Add a useful tool or link.</p>
        </div>

        <form id="toolForm">
            <div class="field">
                <label>Tool Name</label>
                <input name="name" required placeholder="Tool name">
            </div>

            <div class="field">
                <label>Description</label>
                <textarea name="description"
                    placeholder="What does this tool do?"></textarea>
            </div>

            <div class="field">
                <label>Tool URL</label>
                <input name="url" type="url" required
                    placeholder="https://...">
            </div>

            <button class="form-submit" type="submit">
                Publish Tool
            </button>
        </form>
    `);

    $("#toolForm").onsubmit = async event => {
        event.preventDefault();

        const form = new FormData(event.target);

        try {
            await api("/api/tools", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: form.get("name"),
                    description: form.get("description"),
                    url: form.get("url")
                })
            });

            closeModal();
            await loadTools();
            showToast("Tool published!");
        } catch (error) {
            showToast(error.message);
        }
    };
}

// LOAD MODS

async function loadMods() {
    try {
        const data = await api("/api/mods");
        mods = data.mods || [];
        renderMods();
    } catch (error) {
        showToast(error.message);
    }
}

function renderMods() {
    const grid = $("#modGrid");
    if (!grid) return;

    const search = ($("#search")?.value || "").toLowerCase();
    const sort = $("#sort")?.value || "newest";

    let filtered = mods.filter(mod =>
        [mod.name, mod.game, mod.description]
            .some(value =>
                String(value || "").toLowerCase().includes(search)
            )
    );

    if (sort === "downloads") {
        filtered.sort((a, b) =>
            (Number(b.downloads) || 0) - (Number(a.downloads) || 0)
        );
    }

    if (sort === "newest") {
        filtered.sort((a, b) =>
            new Date(b.created_at) - new Date(a.created_at)
        );
    }

    if (!filtered.length) {
        grid.innerHTML = `<p class="empty-message">No mods found.</p>`;
        return;
    }

    grid.innerHTML = filtered.map(mod => `
        <article class="mod-card">
            ${mod.image_url ? `
                <img class="mod-cover"
                    src="${escapeHTML(mod.image_url)}"
                    alt="${escapeHTML(mod.name)}">
            ` : ""}

            <div class="mod-body">
                <h3>${escapeHTML(mod.name)}</h3>
                <p>${escapeHTML(mod.description)}</p>

                <span class="mod-meta">
                    ${escapeHTML(mod.game || "Other")}
                </span>

                <div class="mod-foot">
                    <span>${Number(mod.downloads) || 0} downloads</span>

                    <a class="small-btn"
                        href="/api/mods/${Number(mod.id)}/download">
                        Download
                    </a>
                </div>

                ${currentUser ? `
                    <div class="admin-buttons">
                        <button class="small-btn"
                            data-edit="${Number(mod.id)}">Edit</button>

                        <button class="small-btn"
                            data-delete="${Number(mod.id)}">Delete</button>
                    </div>
                ` : ""}
            </div>
        </article>
    `).join("");

    grid.querySelectorAll("[data-edit]").forEach(button => {
        button.onclick = () => {
            const mod = mods.find(item =>
                item.id === Number(button.dataset.edit)
            );

            if (mod) addModModal(mod);
        };
    });

    grid.querySelectorAll("[data-delete]").forEach(button => {
        button.onclick = async () => {
            if (!confirm("Delete this mod?")) return;

            try {
                await api(`/api/mods/${button.dataset.delete}`, {
                    method: "DELETE"
                });

                await loadMods();
                showToast("Mod deleted.");
            } catch (error) {
                showToast(error.message);
            }
        };
    });
}

$("#search")?.addEventListener("input", renderMods);
$("#sort")?.addEventListener("change", renderMods);

// LOAD TOOLS

async function loadTools() {
    try {
        const data = await api("/api/tools");
        tools = data.tools || [];
        renderTools();
    } catch (error) {
        showToast(error.message);
    }
}

function renderTools() {
    const grid = $("#toolGrid");
    if (!grid) return;

    if (!tools.length) {
        grid.innerHTML = `<p class="empty-message">No tools added yet.</p>`;
        return;
    }

    grid.innerHTML = tools.map(tool => `
        <article class="tool-item">
            <h3>${escapeHTML(tool.name)}</h3>
            <p>${escapeHTML(tool.description)}</p>

            <a class="small-btn"
                href="${escapeHTML(tool.url)}"
                target="_blank"
                rel="noopener noreferrer">
                Open Tool
            </a>

            ${currentUser ? `
                <button class="small-btn"
                    data-delete-tool="${Number(tool.id)}">
                    Delete
                </button>
            ` : ""}
        </article>
    `).join("");

    grid.querySelectorAll("[data-delete-tool]").forEach(button => {
        button.onclick = async () => {
            if (!confirm("Delete this tool?")) return;

            try {
                await api(`/api/tools/${button.dataset.deleteTool}`, {
                    method: "DELETE"
                });

                await loadTools();
                showToast("Tool deleted.");
            } catch (error) {
                showToast(error.message);
            }
        };
    });
}

// START WEBSITE

async function startWebsite() {
    await loadAccount();
    await loadMods();
    await loadTools();
}

startWebsite();
