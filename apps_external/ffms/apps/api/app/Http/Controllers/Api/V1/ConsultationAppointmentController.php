<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Responses\ApiResponse;
use App\Models\ConsultationAppointment;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class ConsultationAppointmentController extends Controller
{
    public function storePublic(Request $request)
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:120'],
            'email' => ['required', 'email', 'max:160'],
            'mobile' => ['required', 'string', 'max:20'],
            'preferred_date' => ['required', 'date'],
            'preferred_time' => ['required', 'string', 'max:60'],
            'topic' => ['required', 'string', 'max:180'],
            'notes' => ['nullable', 'string', 'max:2000'],
        ]);

        $appointment = ConsultationAppointment::create([
            ...$data,
            'id' => (string) Str::uuid(),
            'source' => 'website',
            'status' => 'requested',
        ]);

        return ApiResponse::success([
            'appointment_id' => $appointment->id,
            'message' => 'Your appointment request has been received.',
        ], 201);
    }

    public function index(Request $request)
    {
        $query = ConsultationAppointment::query()->latest();
        if ($request->filled('status')) $query->where('status', $request->string('status'));
        if ($request->filled('search')) {
            $search = $request->string('search');
            $query->where(fn ($items) => $items
                ->where('name', 'like', "%{$search}%")
                ->orWhere('email', 'like', "%{$search}%")
                ->orWhere('mobile', 'like', "%{$search}%"));
        }
        return ApiResponse::success($query->paginate(20));
    }
}
