import { useState, useCallback } from 'react';
import {
  login,
  register,
  verifyOtp,
  loginWithGoogle,
  logout,
  isAuthenticated,
  getCurrentUser,
  LoginCredentials,
  RegisterCredentials,
  AuthResponse,
  OtpChallengeResponse,
} from '../services/authService';


interface UseAuthReturn {
  isAuthenticated: boolean;
  user: AuthResponse['user'] | null;
  loading: boolean;
  error: string | null;
  login: (credentials: LoginCredentials) => Promise<AuthResponse | OtpChallengeResponse>;
  register: (credentials: RegisterCredentials) => Promise<AuthResponse | OtpChallengeResponse>;
  verifyOtp: (challengeToken: string, otp: string) => Promise<AuthResponse>;
  loginWithGoogle: () => Promise<AuthResponse>;
  logout: () => Promise<void>;
  clearError: () => void;
}

export function useAuth(): UseAuthReturn {
  const [user, setUser] = useState<AuthResponse['user'] | null>(null);
  const [isAuthenticatedState, setIsAuthenticatedState] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = useCallback(async (credentials: LoginCredentials) => {
    setLoading(true);
    setError(null);
    try {
      const response = await login(credentials);
      if (!('otp_required' in response)) {
        setUser(response.user);
        setIsAuthenticatedState(true);
      }
      return response;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Login failed';
      setError(errorMessage);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const handleRegister = useCallback(async (credentials: RegisterCredentials) => {
    setLoading(true);
    setError(null);
    try {
      const response = await register(credentials);
      if (!('otp_required' in response)) {
        setUser(response.user);
        setIsAuthenticatedState(true);
      }
      return response;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Registration failed';
      setError(errorMessage);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const handleVerifyOtp = useCallback(async (challengeToken: string, otp: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await verifyOtp(challengeToken, otp);
      setUser(response.user);
      setIsAuthenticatedState(true);
      return response;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Verification failed';
      setError(errorMessage);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const handleLoginWithGoogle = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await loginWithGoogle();
      setUser(response.user);
      setIsAuthenticatedState(true);
      return response;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Google sign-in failed';
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
    verifyOtp: handleVerifyOtp,
    loginWithGoogle: handleLoginWithGoogle,
    logout: handleLogout,
    clearError,
  };
}
