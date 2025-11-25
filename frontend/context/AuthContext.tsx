import React, { createContext, useState, useContext, useEffect, ReactNode } from 'react';
import { User, Role, AuthContextType, EngineeringDepartment } from '../types';

// --- Mock Database Removed ---
// Authentication is now handled via API calls to the Django backend.


// --- Auth Context ---
const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Helper to get token
  const getAccessToken = () => localStorage.getItem('access_token');

  const fetchWithAuth = async (url: string, options: RequestInit = {}) => {
    const token = getAccessToken();
    const headers = {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      ...options.headers,
    };

    const response = await fetch(url, { ...options, headers });
    if (response.status === 401) {
      // Token expired or invalid - simple logout for now
      logout();
      throw new Error("Session expired");
    }
    return response;
  };

  const loadUserProfile = async () => {
    try {
      const res = await fetchWithAuth('/api/accounts/profile/');
      if (res.ok) {
        const data = await res.json();
        // Map backend user to frontend User type
        // Backend: { id, email, first_name, last_name, role, specialization: { name, ... } }
        const userData: User = {
          id: data.id,
          email: data.email,
          firstName: data.first_name,
          role: data.role as Role,
          department: data.specialization?.name as EngineeringDepartment
        };
        setUser(userData);
      } else {
        logout();
      }
    } catch (e) {
      console.error("Failed to load profile", e);
      logout();
    }
  };

  useEffect(() => {
    const initAuth = async () => {
      const token = getAccessToken();
      if (token) {
        await loadUserProfile();
      }
      setIsLoading(false);
    };
    initAuth();
  }, []);

  const login = async (email: string, password: string): Promise<void> => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/token/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || "Login failed");
      }

      const data = await res.json();
      localStorage.setItem('access_token', data.access);
      localStorage.setItem('refresh_token', data.refresh);

      await loadUserProfile();
    } catch (err: any) {
      setError(err.message || "An error occurred during login");
    } finally {
      setIsLoading(false);
    }
  };

  const getSpecializationId = async (departmentName: string | EngineeringDepartment): Promise<string | undefined> => {
    try {
      const res = await fetch('/api/accounts/specializations/');
      if (res.ok) {
        const data = await res.json();
        // Handle both paginated response {results: [...]} and direct array
        const specs = Array.isArray(data) ? data : (data.results || []);
        const spec = specs.find((s: any) => s.name === departmentName);
        return spec?.id;
      }
    } catch (e) {
      console.error("Failed to fetch specializations", e);
    }
    return undefined;
  };

  const register = async (firstName: string, email: string, password: string, role: Role, department?: EngineeringDepartment): Promise<void> => {
    setIsLoading(true);
    setError(null);

    try {
      let specializationId = null;
      if (role === Role.Student && department) {
        specializationId = await getSpecializationId(department);
        if (!specializationId) {
          throw new Error("Invalid specialization selected");
        }
      }

      const res = await fetch('/api/accounts/register/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          password2: password, // Serializer expects this
          first_name: firstName,
          last_name: "", // Optional in frontend, but maybe required by backend? Serializer says required=False usually for blank=True
          role,
          specialization: specializationId
        })
      });

      if (!res.ok) {
        const data = await res.json();
        // Format errors
        const msgs = Object.entries(data).map(([k, v]) => `${k}: ${v}`).join(', ');
        throw new Error(msgs || "Registration failed");
      }

      // Auto login after register
      const data = await res.json();
      localStorage.setItem('access_token', data.access);
      localStorage.setItem('refresh_token', data.refresh);

      // Backend register view returns user data, so we can set it directly or reload
      // But mapping is safer via loadUserProfile or manual mapping
      // The view returns: { user: ..., access: ..., refresh: ... }
      const userData: User = {
        id: data.user.id,
        email: data.user.email,
        firstName: data.user.first_name,
        role: data.user.role as Role,
        department: data.user.specialization?.name as EngineeringDepartment
      };
      setUser(userData);

    } catch (err: any) {
      setError(err.message || "An error occurred during registration");
    } finally {
      setIsLoading(false);
    }
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
  };

  const getAllUsers = (): User[] => {
    // TODO: Implement real API call for Admin
    // For now return empty or fetch if admin
    return [];
  };

  const updateUser = async (email: string, updates: Partial<Omit<User, 'id' | 'email'>>): Promise<void> => {
    // TODO: Implement real API
    console.warn("updateUser not implemented yet");
  };

  const deleteUser = async (email: string): Promise<void> => {
    // TODO: Implement real API
    console.warn("deleteUser not implemented yet");
  };

  const addUser = async (firstName: string, email: string, password: string, role: Role, department?: EngineeringDepartment): Promise<void> => {
    // Reuse register logic but without auto-login? 
    // Admin creating user.
    // For now, just warn.
    console.warn("addUser not implemented yet");
  };


  const value = {
    user,
    isAuthenticated: !!user,
    isLoading,
    error,
    login,
    register,
    logout,
    getAllUsers,
    updateUser,
    deleteUser,
    addUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};