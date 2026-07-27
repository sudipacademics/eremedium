<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class FeaturedFranchisee extends Model
{
    public $incrementing = false;
    protected $keyType = 'string';

    protected $fillable = [
        'id',
        'name',
        'location',
        'franchise_type',
        'image_url',
        'is_featured',
        'sort_order',
    ];

    protected function casts(): array
    {
        return ['is_featured' => 'boolean'];
    }
}
