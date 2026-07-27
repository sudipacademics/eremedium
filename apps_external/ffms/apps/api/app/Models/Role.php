<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

class Role extends Model
{
    public $incrementing = false;
    protected $keyType = 'string';
    protected $fillable = ['id', 'name', 'label'];
    public function permissions(): BelongsToMany { return $this->belongsToMany(Permission::class, 'role_permissions'); }
}
