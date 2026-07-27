<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Responses\ApiResponse;
use App\Models\LoginChallenge;
use App\Models\Role;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

class AuthController extends Controller
{
    public function registerApplicant(Request $request)
    {
        $data = $request->validate(['name' => ['required', 'string', 'max:120'], 'email' => ['required', 'email', 'unique:users,email'], 'mobile' => ['required', 'string', 'max:20', 'unique:users,mobile'], 'password' => ['required', 'string', 'min:8', 'confirmed']]);
        $role = Role::where('name', 'applicant')->firstOrFail();
        $user = User::create([...$data, 'role_id' => $role->id, 'status' => 'active']);
        return ApiResponse::success(['user_id' => $user->id, 'message' => 'Applicant account created.'], 201);
    }

    public function requestOtp(Request $request)
    {
        $data = $request->validate(['email' => ['required', 'email'], 'password' => ['required', 'string'], 'role_type' => ['required', 'in:applicant,officer']]);
        $user = User::where('email', $data['email'])->first();
        if (! $user || ! Hash::check($data['password'], $user->password) || $user->status !== 'active') return ApiResponse::error('INVALID_CREDENTIALS', 'Invalid email, password, or account status.', 422);
        $role = Role::find($user->role_id);
        if (! $role || ($data['role_type'] === 'applicant') !== ($role->name === 'applicant')) return ApiResponse::error('ROLE_MISMATCH', 'Use the appropriate login type for this account.', 422);
        $otp = app()->environment('local') ? '123456' : (string) random_int(100000, 999999);
        $challenge = LoginChallenge::create(['id' => (string) Str::uuid(), 'email' => $user->email, 'role_type' => $data['role_type'], 'otp_hash' => Hash::make($otp), 'expires_at' => now()->addMinutes(5)]);
        $payload = ['challenge_id' => $challenge->id, 'expires_in_seconds' => 300];
        if (app()->environment('local')) $payload['development_otp'] = $otp;
        return ApiResponse::success($payload);
    }

    public function verifyOtp(Request $request)
    {
        $data = $request->validate(['challenge_id' => ['required', 'uuid'], 'otp' => ['required', 'digits:6']]);
        $challenge = LoginChallenge::find($data['challenge_id']);
        if (! $challenge || $challenge->expires_at->isPast() || $challenge->attempts >= 5) return ApiResponse::error('CHALLENGE_INVALID', 'OTP challenge is invalid or expired.', 422);
        $challenge->increment('attempts');
        if (! Hash::check($data['otp'], $challenge->otp_hash)) return ApiResponse::error('OTP_INVALID', 'The OTP is incorrect.', 422);
        $user = User::where('email', $challenge->email)->firstOrFail();
        $challenge->update(['verified_at' => now()]);
        $token = $user->createToken('rfms-web')->plainTextToken;
        $role = Role::find($user->role_id);
        return ApiResponse::success(['token' => $token, 'user' => ['id' => $user->id, 'name' => $user->name, 'role_id' => $user->role_id, 'role' => $role?->name]]);
    }

    public function logout(Request $request) { $request->user()->currentAccessToken()?->delete(); return ApiResponse::success(['message' => 'Signed out.']); }
}
