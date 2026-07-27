<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Lead extends Model
{
    public $incrementing = false;
    protected $keyType = 'string';
    protected $fillable = ['id', 'name', 'email', 'mobile', 'source', 'franchise_model', 'territory_query', 'stage', 'assigned_to', 'follow_up_at', 'notes', 'converted_at'];
    protected function casts(): array { return ['follow_up_at' => 'datetime', 'converted_at' => 'datetime']; }
}
