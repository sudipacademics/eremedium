<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void {
        Schema::table('users', function (Blueprint $table): void {
            $table->string('mobile', 20)->nullable()->unique()->after('email');
            $table->uuid('role_id')->nullable()->index()->after('password');
            $table->string('status')->default('active')->after('role_id');
        });
        Schema::create('login_challenges', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->string('email')->index();
            $table->string('role_type');
            $table->string('otp_hash');
            $table->unsignedTinyInteger('attempts')->default(0);
            $table->timestamp('expires_at');
            $table->timestamp('verified_at')->nullable();
            $table->timestamps();
        });
    }
    public function down(): void { Schema::dropIfExists('login_challenges'); Schema::table('users', fn (Blueprint $table) => $table->dropColumn(['mobile', 'role_id', 'status'])); }
};
