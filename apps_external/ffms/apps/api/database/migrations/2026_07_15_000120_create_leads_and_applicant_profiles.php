<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void {
        Schema::create('leads', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->string('name'); $table->string('email')->nullable()->index(); $table->string('mobile', 20)->index();
            $table->string('source')->default('website'); $table->string('franchise_model')->nullable(); $table->string('territory_query')->nullable();
            $table->string('stage')->default('new')->index(); $table->unsignedBigInteger('assigned_to')->nullable()->index();
            $table->timestamp('follow_up_at')->nullable()->index(); $table->text('notes')->nullable(); $table->timestamp('converted_at')->nullable();
            $table->timestamps(); $table->softDeletes();
        });
        Schema::create('applicant_profiles', function (Blueprint $table): void {
            $table->uuid('id')->primary(); $table->unsignedBigInteger('user_id')->unique(); $table->uuid('lead_id')->nullable()->unique();
            $table->string('application_number')->unique(); $table->string('franchise_model')->nullable(); $table->string('application_stage')->default('draft')->index();
            $table->unsignedBigInteger('assigned_manager_id')->nullable()->index(); $table->timestamp('submitted_at')->nullable(); $table->timestamps();
        });
    }
    public function down(): void { Schema::dropIfExists('applicant_profiles'); Schema::dropIfExists('leads'); }
};
