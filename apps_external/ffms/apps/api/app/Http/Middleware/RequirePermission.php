<?php

namespace App\Http\Middleware;

use App\Http\Responses\ApiResponse;
use App\Models\Role;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class RequirePermission
{
    public function handle(Request $request, Closure $next, string $permission): Response
    {
        $user = $request->user();
        $allowed = $user && $user->role_id && Role::find($user->role_id)?->permissions()->where('key', $permission)->exists();
        return $allowed ? $next($request) : ApiResponse::error('FORBIDDEN', 'You do not have permission for this action.', 403);
    }
}
