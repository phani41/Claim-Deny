import { useEffect, useState } from "react";
import { 
  Users, 
  UserPlus, 
  Search, 
  Shield, 
  CheckCircle, 
  XCircle, 
  Filter, 
  KeyRound,
  AlertCircle
} from "lucide-react";
import { api } from "../api/client.js";
import { useAuth } from "../context/auth-context.jsx";
import { useToast } from "../context/toast-context.jsx";
import { formatDate } from "../lib/format.js";
import { Button, Card, EmptyState, Input, Modal, Select } from "../components/ui.jsx";

const ROLE_OPTIONS = [
  { value: "BILLING_SPECIALIST", label: "Billing Specialist" },
  { value: "REVIEWER", label: "Reviewer" },
  { value: "ADMIN", label: "Admin" }
];

export function AdminUsersPage() {
  const { user: currentUser } = useAuth();
  const { showToast } = useToast();
  const [users, setUsers] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    email: "",
    displayName: "",
    role: "BILLING_SPECIALIST",
    password: ""
  });
  const [formError, setFormError] = useState("");

  function loadUsers(page = 1) {
    setLoading(true);
    api.adminUsers({ page, limit: 20, search, role: roleFilter })
      .then((res) => {
        setUsers(res.data || []);
        setPagination(res.pagination || { page: 1, limit: 20, total: 0 });
      })
      .catch((err) => {
        showToast(err.message || "Failed to load users", { type: "error" });
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      loadUsers(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [search, roleFilter]);

  async function handleToggleStatus(u) {
    if (u.id === currentUser?.id) {
      showToast("You cannot deactivate your own account.", { type: "error" });
      return;
    }
    const newStatus = !u.active;
    try {
      await api.updateUserStatus(u.id, newStatus);
      showToast(`User ${u.displayName} has been ${newStatus ? "activated" : "deactivated"}.`, { type: "success" });
      loadUsers(pagination.page);
    } catch (err) {
      showToast(err.message || "Failed to update user status", { type: "error" });
    }
  }

  async function handleChangeRole(u, newRole) {
    if (u.id === currentUser?.id) {
      showToast("You cannot modify your own administrative role.", { type: "error" });
      return;
    }
    try {
      await api.updateUserRole(u.id, newRole);
      showToast(`Role for ${u.displayName} updated to ${newRole}.`, { type: "success" });
      loadUsers(pagination.page);
    } catch (err) {
      showToast(err.message || "Failed to update role", { type: "error" });
    }
  }

  async function handleCreateUser(e) {
    e.preventDefault();
    setFormError("");
    if (!formData.email || !formData.displayName || !formData.password) {
      setFormError("All fields are required.");
      return;
    }
    if (formData.password.length < 6) {
      setFormError("Password must be at least 6 characters.");
      return;
    }
    try {
      setCreating(true);
      await api.createAdminUser(formData);
      showToast(`User ${formData.displayName} created successfully!`, { type: "success" });
      setModalOpen(false);
      setFormData({ email: "", displayName: "", role: "BILLING_SPECIALIST", password: "" });
      loadUsers(1);
    } catch (err) {
      setFormError(err.message || "Failed to create user account.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">User Management</h1>
          <p className="mt-1 text-xs text-slate-500">
            Control user access, assign organizational roles, and enforce account activity across the system.
          </p>
        </div>
        <Button icon={UserPlus} onClick={() => setModalOpen(true)}>
          Create New User
        </Button>
      </div>

      {/* Filter Bar */}
      <Card className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search by name or email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-md border border-slate-200 bg-white py-1.5 pl-9 pr-3 text-xs placeholder:text-slate-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
            />
          </div>
          <div className="w-full sm:w-48">
            <Select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              options={[
                { value: "", label: "All Roles" },
                ...ROLE_OPTIONS
              ]}
            />
          </div>
        </div>
      </Card>

      {/* Users Table */}
      <Card className="overflow-hidden">
        {loading ? (
          <div className="flex h-48 items-center justify-center">
            <div className="size-6 animate-spin rounded-full border-2 border-teal-600 border-t-transparent" />
          </div>
        ) : users.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No users found"
            description={search || roleFilter ? "Try changing your search keywords or filter criteria." : "No accounts have been registered."}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50/75 text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-semibold">User</th>
                  <th className="px-4 py-3 font-semibold">Email</th>
                  <th className="px-4 py-3 font-semibold">Role</th>
                  <th className="px-4 py-3 font-semibold text-center">Status</th>
                  <th className="px-4 py-3 font-semibold">Created Date</th>
                  <th className="px-4 py-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.map((u) => {
                  const isSelf = u.id === currentUser?.id;
                  return (
                    <tr key={u.id} className="hover:bg-slate-50/50">
                      <td className="px-4 py-3 font-semibold text-slate-900">
                        <div className="flex items-center gap-2">
                          <span>{u.displayName}</span>
                          {isSelf && (
                            <span className="rounded bg-teal-50 px-1.5 py-0.5 text-[9px] font-bold text-teal-700">
                              You
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-600 font-mono text-[11px]">{u.email}</td>
                      <td className="px-4 py-3">
                        <select
                          value={u.role}
                          disabled={isSelf}
                          onChange={(e) => handleChangeRole(u, e.target.value)}
                          className="rounded border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 disabled:bg-slate-100 disabled:opacity-60 focus:border-teal-500 focus:outline-none"
                        >
                          <option value="BILLING_SPECIALIST">Billing Specialist</option>
                          <option value="REVIEWER">Reviewer</option>
                          <option value="ADMIN">Admin</option>
                        </select>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          u.active ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"
                        }`}>
                          <span className={`size-1.5 rounded-full ${u.active ? "bg-emerald-500" : "bg-red-500"}`} />
                          {u.active ? "Active" : "Deactivated"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-500">{formatDate(u.createdAt)}</td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          size="sm"
                          variant={u.active ? "secondary" : "default"}
                          disabled={isSelf}
                          className={u.active ? "text-red-600 hover:bg-red-50" : "bg-emerald-600 hover:bg-emerald-700"}
                          onClick={() => handleToggleStatus(u)}
                        >
                          {u.active ? "Deactivate" : "Activate"}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Create User Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Create New User Account"
        description="Register a new staff member and assign their system role."
      >
        <form onSubmit={handleCreateUser} className="space-y-4">
          {formError && (
            <div className="flex items-center gap-2 rounded-md bg-red-50 p-3 text-xs text-red-700 border border-red-200">
              <AlertCircle size={15} className="shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Full Name</label>
            <Input
              type="text"
              placeholder="e.g. Vikram Malhotra"
              value={formData.displayName}
              onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Email Address</label>
            <Input
              type="email"
              placeholder="e.g. vikram@demo.in"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">System Role</label>
            <Select
              value={formData.role}
              onChange={(e) => setFormData({ ...formData, role: e.target.value })}
              options={ROLE_OPTIONS}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Initial Password</label>
            <Input
              type="password"
              placeholder="Minimum 6 characters"
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              required
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" type="button" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={creating}>
              Create User
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

