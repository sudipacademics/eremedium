<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class HeroSlide extends Model
{
    public $incrementing = false;
    protected $keyType = 'string';

    protected $fillable = [
        'id', 'title', 'description', 'primary_button_text', 'primary_button_url',
        'secondary_button_text', 'secondary_button_url', 'image_url', 'is_published', 'sort_order',
    ];

    protected function casts(): array { return ['is_published' => 'boolean']; }
}
