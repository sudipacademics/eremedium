<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ConsultationAppointment extends Model
{
    public $incrementing = false;
    protected $keyType = 'string';

    protected $fillable = [
        'id',
        'name',
        'email',
        'mobile',
        'preferred_date',
        'preferred_time',
        'topic',
        'notes',
        'source',
        'status',
    ];

    protected function casts(): array
    {
        return ['preferred_date' => 'date'];
    }
}
