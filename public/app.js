const $ = (selector) => document.querySelector(selector);

let currentUser = null;
let mods = [];
let tools = [];

const modalBackdrop = $("#modalBackdrop");
const modalContent = $("#modalContent");

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

function openModal(content) {
    modalContent.innerHTML = content;
    modalBackdrop.classList.add("active");
}

function closeModal() {
    modalBackdrop.classList.remove("active");
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

        <form id="loginForm" class="site-form">
            <label>Username</label>
            <input name="username" placeholder="Username" required>

            <label>Password</label>
            <input name="password" type="password"
                placeholder="Password" required>

            <button class="primary-button" type="submit">
                Login
            </button>
        </form>
    `);
}

$("#loginOpen")?.addEventListener("click", loginModal);

$("#loginForm")?.addEventListener("submit", handleLogin);

document.addEventListener("submit", async event => {
    if (event.target.id !== "loginForm") return;
    await handleLogin(event);
});

async function handleLogin(event) {
    if (event.target.id !== "loginForm") return;

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
        showToast("Welcome back!");
    } catch (error) {
        showToast(error.message);
    }
}

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
            if (accountButton) accountButton.style.display = "none";
        }
    } catch {
        currentUser = null;
    }
}

// OWNER PANEL

$("#accountBtn")?.addEventListener("click", ownerPanel);

function ownerPanel() {
    if (!currentUser) return loginModal();

    openModal(`
        <div class="modal-heading">
            <h2>Owner Panel</h2>
            <p>Manage your PENG.LOL website.</p>
        </div>

        <div class="owner-actions">
            <button class="primary-button" id="addModButton">
                Add a Mod
            </button>

            <button class="primary-button" id="addToolButton">
                Add a Tool
            </button>

            <button class="secondary-button" id="logoutButton">
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
        closeModal();
        showToast("Logged out.");
    } catch (error) {
        showToast(error.message);
    }
}

// ADD / EDIT MODS

function addModModal(mod = null) {
    const editing = Boolean(mod);

    openModal(`
        <div class="modal-heading">
            <h2>${editing ? "Edit Mod" : "Add a Mod"}</h2>
            <p>${editing ? "Update your mod." : "Publish a new mod on PENG.LOL."}</p>
        </div>

        <form id="modForm" class="site-form">
            <label>Mod Name</label>
            <input name="name" required
                value="${escapeHTML(mod?.name || "")}"
                placeholder="My Awesome Mod">

            <label>Game</label>
            <input name="game"
                value="${escapeHTML(mod?.game || "")}"
                placeholder="Game name">

            <label>Description</label>
            <textarea name="description" required
                placeholder="Describe your mod...">${escapeHTML(mod?.description || "")}</textarea>

            <label>Download URL</label>
            <input name="download_url" type="url" required
                value="${escapeHTML(mod?.download_url || "")}"
                placeholder="https://...">

            <label>Mod Image</label>
            <input name="image" type="file" accept="image/*">

            <button class="primary-button" type="submit">
                ${editing ? "Save Changes" : "Publish Mod"}
            </button>
        </form>
    `);

    $("#modForm").onsubmit = async event => {
        event.preventDefault();

        const formData = new FormData(event.target);

        try {
            await api(editing ? `/api/mods/${mod.id}` : "/api/mods", {
                method: editing ? "PUT" : "POST",
                body: formData
            });

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
    openModal(`
        <div class="modal-heading">
            <h2>Add a Tool</h2>
            <p>Add a downloadable tool or useful link.</p>
        </div>

        <form id="toolForm" class="site-form">
            <label>Tool Name</label>
            <input name="name" required placeholder="Tool name">

            <label>Description</label>
            <textarea name="description"
                placeholder="What does this tool do?"></textarea>

            <label>Tool URL</label>
            <input name="url" type="url" required
                placeholder="https://...">

            <button class="primary-button" type="submit">
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
            .some(value => String(value || "").toLowerCase().includes(search))
    );

    if (sort === "downloads") {
        filtered.sort((a, b) => b.downloads - a.downloads);
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
                <img class="mod-image"
                    src="${escapeHTML(mod.image_url)}"
                    alt="${escapeHTML(mod.name)}">
            ` : ""}

            <div class="mod-card-content">
                <h3>${escapeHTML(mod.name)}</h3>

                <p>${escapeHTML(mod.description)}</p>

                <span class="mod-game">
                    ${escapeHTML(mod.game || "Other")}
                </span>

                <div class="mod-card-footer">
                    <span>${Number(mod.downloads) || 0} downloads</span>

                    <a class="primary-button"
                        href="/api/mods/${mod.id}/download">
                        Download
                    </a>
                </div>

                ${currentUser ? `
                    <div class="admin-buttons">
                        <button data-edit="${mod.id}">Edit</button>
                        <button data-delete="${mod.id}">Delete</button>
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
        <article class="tool-card">
            <h3>${escapeHTML(tool.name)}</h3>
            <p>${escapeHTML(tool.description)}</p>

            <a class="primary-button"
                href="${escapeHTML(tool.url)}"
                target="_blank"
                rel="noopener noreferrer">
                Open Tool
            </a>

            ${currentUser ? `
                <button class="delete-tool"
                    data-delete-tool="${tool.id}">
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
