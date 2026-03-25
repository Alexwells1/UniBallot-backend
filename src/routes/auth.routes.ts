import { Router } from 'express';
import { validate } from '../middleware/validate';
import { authenticate } from '../middleware/authenticate';
import {
  registrationLimiter,
  loginLimiter,
  otpLimiter,
  refreshLimiter,
} from '../middleware/rateLimiter';
import {
  register,     registerSchema,
  verifyOtp,    verifyOtpSchema,
  resendOtp,    resendOtpSchema,
  otpStatus,    otpStatusSchema,
  login,        loginSchema,
  refresh,      refreshSchema,
  logout,
} from '../controllers/auth.controller';

const router = Router();

router.post('/register',    registrationLimiter, validate(registerSchema),    register);
router.post('/verify-otp',  otpLimiter,          validate(verifyOtpSchema),   verifyOtp);
router.post('/resend-otp',  otpLimiter,          validate(resendOtpSchema),   resendOtp);

// GET — query param validation uses 'query' source
router.get('/otp-status',   otpLimiter,          validate(otpStatusSchema, 'query'), otpStatus);

router.post('/login',       loginLimiter,         validate(loginSchema),       login);
router.post('/refresh',     refreshLimiter,  validate(refreshSchema),  refresh);
router.post('/logout',      authenticate,                                      logout);

export default router;