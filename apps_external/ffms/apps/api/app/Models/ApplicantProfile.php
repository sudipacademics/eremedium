<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ApplicantProfile extends Model
{
    public $incrementing = false;
    protected $keyType = 'string';
    protected $fillable = ['id', 'user_id', 'lead_id', 'application_number', 'franchise_model', 'application_stage', 'assigned_manager_id', 'submitted_at'];
    protected function casts(): array { return ['submitted_at' => 'datetime']; }
}
