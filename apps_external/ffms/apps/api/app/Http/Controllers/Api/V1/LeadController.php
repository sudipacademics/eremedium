<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Responses\ApiResponse;
use App\Models\ApplicantProfile;
use App\Models\Lead;
use App\Models\Role;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

class LeadController extends Controller
{
    public function storePublic(Request $request)
    {
        $data = $request->validate(['name' => ['required', 'string', 'max:120'], 'email' => ['required', 'email'], 'mobile' => ['required', 'string', 'max:20'], 'franchise_model' => ['required', 'in:FOFO,FOCO'], 'territory_query' => ['required', 'string', 'max:200'], 'notes' => ['nullable', 'string', 'max:2000']]);
        $lead = Lead::create([...$data, 'id' => (string) Str::uuid(), 'source' => 'website', 'stage' => 'new']);
        return ApiResponse::success(['lead_id' => $lead->id, 'message' => 'Your franchise enquiry has been received.'], 201);
    }

    public function index(Request $request)
    {
        $query = Lead::query()->latest();
        if ($request->filled('stage')) $query->where('stage', $request->string('stage'));
        if ($request->filled('search')) $query->where(fn ($q) => $q->where('name', 'like', '%'.$request->string('search').'%')->orWhere('email', 'like', '%'.$request->string('search').'%')->orWhere('mobile', 'like', '%'.$request->string('search').'%'));
        return ApiResponse::success($query->paginate(20));
    }

    public function update(Request $request, Lead $lead)
    {
        $data = $request->validate(['stage' => ['sometimes', 'in:new,contacted,qualified,consultation_booked,application_started,application_submitted,lost,nurture'], 'assigned_to' => ['nullable', 'integer', 'exists:users,id'], 'follow_up_at' => ['nullable', 'date'], 'notes' => ['nullable', 'string', 'max:2000']]);
        $lead->update($data);
        return ApiResponse::success($lead->fresh());
    }

    public function convert(Request $request, Lead $lead)
    {
        if ($lead->converted_at) return ApiResponse::error('LEAD_ALREADY_CONVERTED', 'This lead has already been converted.', 422);
        $profile = DB::transaction(function () use ($lead) {
            $role = Role::where('name', 'applicant')->firstOrFail();
            $user = User::firstOrCreate(['email' => $lead->email], ['name' => $lead->name, 'mobile' => $lead->mobile, 'password' => Hash::make(Str::random(40)), 'role_id' => $role->id, 'status' => 'pending_password_setup']);
            $profile = ApplicantProfile::create(['id' => (string) Str::uuid(), 'user_id' => $user->id, 'lead_id' => $lead->id, 'application_number' => 'RFMS-'.now()->format('Y').'-'.str_pad((string) (ApplicantProfile::count() + 1), 5, '0', STR_PAD_LEFT), 'franchise_model' => $lead->franchise_model, 'application_stage' => 'draft', 'assigned_manager_id' => $lead->assigned_to]);
            $lead->update(['stage' => 'application_started', 'converted_at' => now()]);
            return $profile;
        });
        return ApiResponse::success($profile, 201);
    }
}
