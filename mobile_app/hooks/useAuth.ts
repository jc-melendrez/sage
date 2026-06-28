import { useState, useCallback } from 'react';
import {
  login,
  register,
  logout,
  isAuthenticated,
  getCurrentUser,
  LoginCredentials,
  RegisterCredentials,
  AuthResponse,
} from '../services/authService';


interface UseAuthReturn {
  isAuthenticated: boolean;
  user: AuthResponse['user'] | null;
  loading: boolean;
  error: string | null;
  login: (credentials: LoginCredentials) => Promise<void>;
  register: (credentials: RegisterCredentials) => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
}

export function useAuth(): UseAuthReturn {
  const [user, setUser] = useState<AuthResponse['user'] | null>(null);
  const [isAuthenticatedState, setIsAuthenticatedState] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = useCallback(async (credentials: LoginCredentials) => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await login(credentials);
      setUser(response.user);
      setIsAuthenticatedState(true);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Login failed';
      setError(errorMessage);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const handleRegister = useCallback(async (credentials: RegisterCredentials) => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await register(credentials);
      setUser(response.user);
      setIsAuthenticatedState(true);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Registration failed';
      setError(errorMessage);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      setLoading(true);
      await logout();
      setUser(null);
      setIsAuthenticatedState(false);
      setError(null);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Logout failed';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    isAuthenticated: isAuthenticatedState,
    user,
    loading,
    error,
    login: handleLogin,
    register: handleRegister,
    logout: handleLogout,
    clearError,
  };
}
