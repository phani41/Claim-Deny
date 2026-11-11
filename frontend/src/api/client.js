const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";

export class ApiError extends Error {
  constructor(message, { status = 0, code = "NETWORK_ERROR", details = null } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function request(path, { method = "GET", body } = {}) {
  const jwt = window.localStorage.getItem("hlt06.token");
  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;
  let response;
  try {
    response = await fetch(API_BASE + path, {
      method,
      headers: {
        ...(body && !isFormData ? { "Content-Type": "application/json" } : {}),
        ...(jwt ? { Authorization: "Bearer " + jwt } : {})
      },
      ...(body ? { body: isFormData ? body : JSON.stringify(body) } : {})
    });
  } catch {
    throw new ApiError("The Node API could not be reached. Check that the backend is running.");
  }

  let payload = {};
  try { payload = await response.json(); } catch { payload = {}; }
  if (!response.ok) {
    if (response.status === 401 && jwt) {
      window.localStorage.removeItem("hlt06.token");
      window.localStorage.removeItem("hlt06.user");
      window.dispatchEvent(new Event("hlt06:auth-expired"));
    }
    throw new ApiError(payload.message || "The request could not be completed.", {
      status: response.status,
      code: payload.code || "REQUEST_FAILED",
      details: payload.details || null
    });
  }
  return payload.data ?? payload;
}

function pageQuery({ page = 1, limit = 20, ...filters } = {}) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  }
  return "?" + params.toString();
}

export const api = {
  health: () => request("/health"),
  login: (credentials) => request("/auth/login", { method: "POST", body: credentials }),
  me: () => request("/auth/me"),
  claims: (query) => request("/claims" + pageQuery(query)),
  claim: (id) => request("/claims/" + encodeURIComponent(id)),
  documents: (claimId) => request("/claims/" + encodeURIComponent(claimId) + "/documents"),
  documentDownloadUrl: (id) => {
    const token = typeof window !== "undefined" ? window.localStorage.getItem("hlt06.token") : null;
    return `${API_BASE}/documents/${encodeURIComponent(id)}/download${token ? `?token=${encodeURIComponent(token)}` : ""}`;
  },
  fetchDocumentBlob: async (id) => {
    const jwt = window.localStorage.getItem("hlt06.token");
    const res = await fetch(`${API_BASE}/documents/${encodeURIComponent(id)}/download`, {
      headers: { ...(jwt ? { Authorization: "Bearer " + jwt } : {}) }
    });
    if (!res.ok) throw new Error("Failed to load document.");
    return await res.blob();
  },
  retryDocument: (claimId, documentId) => request("/claims/" + encodeURIComponent(claimId) + "/documents/" + encodeURIComponent(documentId) + "/retry", { method: "POST", body: {} }),
  uploadDocument: (claimId, { file, type, sourceDate }) => {
    const form = new FormData();
    form.append("file", file);
    form.append("type", type);
    if (sourceDate) form.append("sourceDate", new Date(sourceDate + "T12:00:00.000Z").toISOString());
    return request("/claims/" + encodeURIComponent(claimId) + "/documents", { method: "POST", body: form });
  },
  attachPredefined: (claimId, body = {}) => request("/claims/" + encodeURIComponent(claimId) + "/documents/attach-predefined", { method: "POST", body }),
  createClaim: (values) => request("/claims", { method: "POST", body: values }),
  denials: (query) => request("/denials" + pageQuery(query)),
  denial: (id) => request("/denials/" + encodeURIComponent(id)),
  denialReasons: (query) => request("/denialreasons" + pageQuery(query)),
  reviewers: () => request("/reviewers"),
  evidences: (query) => request("/evidences" + pageQuery(query)),
  createEvidence: (values) => request("/evidences", { method: "POST", body: values }),
  organizations: (query = {}) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
    }
    const qs = params.toString();
    return request("/organizations" + (qs ? "?" + qs : ""));
  },
  dashboardStats: () => request("/stats"),
  reviewClaim: (id, body) => request("/claims/" + encodeURIComponent(id) + "/review", { method: "POST", body }),
  reviseAppealLetter: (id, body = {}) => request("/appealletters/" + encodeURIComponent(id) + "/revise", { method: "POST", body }),
  analyzeRejection: (claimId, body = {}) => request("/claims/" + encodeURIComponent(claimId) + "/ai/analyze-rejection", { method: "POST", body }),
  analyzeDenial: (claimId, body = {}) => request("/claims/" + encodeURIComponent(claimId) + "/ai/analyze-denial", { method: "POST", body }),
  appealLetters: (query) => request("/appealletters" + pageQuery(query)),
  appealLetter: (id) => request("/appealletters/" + encodeURIComponent(id)),
  updateAppealLetter: (id, body) => request("/appealletters/" + encodeURIComponent(id), { method: "PATCH", body }),
  submitAppealLetter: (id, body = {}) => request("/appealletters/" + encodeURIComponent(id) + "/submit", { method: "POST", body }),
  approveAppealLetter: (id, body) => request("/appealletters/" + encodeURIComponent(id) + "/approve", { method: "POST", body }),
  rejectAppealLetter: (id, body) => request("/appealletters/" + encodeURIComponent(id) + "/reject", { method: "POST", body }),
  retrieveEvidence: (claimId, input) => request("/claims/" + encodeURIComponent(claimId) + "/rag/retrieve", { method: "POST", body: input }),
  generateAppeal: (claimId, input) => request("/ai/run", { method: "POST", body: { ...input, claimId } }),
  adminStats: () => request("/admin/stats"),
  adminUsers: (query) => request("/admin/users" + pageQuery(query)),
  createAdminUser: (body) => request("/admin/users", { method: "POST", body }),
  updateUserStatus: (id, active) => request("/admin/users/" + encodeURIComponent(id) + "/status", { method: "PATCH", body: { active } }),
  updateUserRole: (id, role) => request("/admin/users/" + encodeURIComponent(id) + "/role", { method: "PATCH", body: { role } }),
  knowledgeDocuments: (query) => request("/knowledge-documents" + pageQuery(query)),
  adminKnowledgeDocuments: (query) => request("/admin/knowledge-documents" + pageQuery(query)),
  reindexKnowledgeDocument: (id) => request("/admin/knowledge-documents/" + encodeURIComponent(id) + "/reindex", { method: "POST" }),
  adminAuditLogs: (query) => request("/admin/audit-logs" + pageQuery(query))
};

