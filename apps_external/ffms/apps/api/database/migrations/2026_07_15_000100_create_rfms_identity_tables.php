<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void {
        Schema::create('roles', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->string('name')->unique();
            $table->string('label');
            $table->timestamps();
        });
        Schema::create('permissions', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->string('key')->unique();
            $table->string('label');
            $table->timestamps();
        });
        Schema::create('role_permissions', function (Blueprint $table): void {
            $table->uuid('role_id'); $table->uuid('permission_id');
            $table->primary(['role_id', 'permission_id']);
        });
        Schema::create('audit_logs', function (Blueprint $table): void {
            $table->bigIncrements('id');
            $table->uuid('actor_id')->nullable()->index();
            $table->string('action');
            $table->string('entity_type');
            $table->uuid('entity_id')->nullable()->index();
            $table->json('before')->nullable();
            $table->json('after')->nullable();
            $table->ipAddress('ip_address')->nullable();
            $table->string('user_agent', 1000)->nullable();
            $table->timestamp('created_at')->useCurrent();
        });
    }
    public function down(): void { Schema::dropIfExists('audit_logs'); Schema::dropIfExists('role_permissions'); Schema::dropIfExists('permissions'); Schema::dropIfExists('roles'); }
};
