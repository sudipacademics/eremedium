<?php

namespace App\Http\Responses;

use Illuminate\Http\JsonResponse;

final class ApiResponse
{
    public static function success(mixed $data, int $status = 200): JsonResponse
    {
        return response()->json(['success' => true, 'data' => $data], $status);
    }

    public static function error(string $code, string $message, int $status): JsonResponse
    {
        return response()->json(['success' => false, 'error' => compact('code', 'message')], $status);
    }
}
