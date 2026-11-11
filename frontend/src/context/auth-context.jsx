import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api } from "../api/client.js";

const AuthContext = createContext(null);

export function getDefaultRoute(role) {
  if (role === "ADMIN") return "/admin/dashboard";
  if (role === "REVIEWER" || role === "COMPLIANCE_REVIEWER") return "/reviewer/dashboard";
  if (role === "BILLING_SPECIALIST" || role === "PROVIDER") return "/billing/dashboard";
  return "/login";
}

function readUser() {
  try {
    const stored = window.localStorage.getItem("hlt06.user");
    return stored ? JSON.parse(stored) : null;
  } catch { return null; }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(readUser);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const expire = () => {
      setUser(null);
      setLoading(false);
    };
    window.addEventListener("hlt06:auth-expired", expire);

    // Verify token on mount with GET /auth/me
    const token = window.localStorage.getItem("hlt06.token");
    if (token) {
      api.me()
        .then((res) => {
          if (res?.user) {
            window.localStorage.setItem("hlt06.user", JSON.stringify(res.user));
            setUser(res.user);
          }
        })
        .catch(() => {
          window.localStorage.removeItem("hlt06.token");
          window.localStorage.removeItem("hlt06.user");
          setUser(null);
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }

    return () => window.removeEventListener("hlt06:auth-expired", expire);
  }, []);

  async function login(credentials) {
    const result = await api.login(credentials);
    window.localStorage.setItem("hlt06.token", result.token);
    window.localStorage.setItem("hlt06.user", JSON.stringify(result.user));
    setUser(result.user);
    return result.user;
  }

  function logout() {
    window.localStorage.removeItem("hlt06.token");
    window.localStorage.removeItem("hlt06.user");
    setUser(null);
  }

  const value = useMemo(() => ({
    user,
    loading,
    isAdmin: user?.role === "ADMIN",
    isBillingSpecialist: user?.role === "BILLING_SPECIALIST" || user?.role === "PROVIDER",
    isReviewer: user?.role === "REVIEWER" || user?.role === "COMPLIANCE_REVIEWER",
    login,
    logout
  }), [user, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider.");
  return value;
}

