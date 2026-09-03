import axios from "axios";

// In production (Vercel), VITE_API_URL points at the deployed backend.
// Locally, it falls back to "/api", which Vite proxies to localhost:4000.
const baseURL = import.meta.env.VITE_API_URL || "/api";
const client = axios.create({ baseURL });

client.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

client.interceptors.response.use(
  (res) => res,
  (err) => {
    // A 401 on the login request itself just means wrong credentials — let Login.jsx show the
    // server's actual message. Previously this redirected immediately on every 401, including
    // login failures, which wiped the page before the specific error could ever be displayed.
    const isLoginRequest = err.config?.url?.includes("/auth/login");
    if (err.response?.status === 401 && !isLoginRequest) {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      window.location.href = "/login";
    }
    return Promise.reject(err);
  }
);

export default client;
