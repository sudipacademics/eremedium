<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class LoginChallenge extends Model
{
    public $incrementing = false;
    protected $keyType = 'string';
    protected $fillable = ['id', 'email', 'role_type', 'otp_hash', 'expires_at', 'attempts', 'verified_at'];
    protected function casts(): array { return ['expires_at' => 'datetime', 'verified_at' => 'datetime']; }
}
