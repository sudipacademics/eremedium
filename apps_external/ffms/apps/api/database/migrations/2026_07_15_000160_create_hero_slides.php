<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('hero_slides', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->string('title', 220);
            $table->text('description')->nullable();
            $table->string('primary_button_text', 80)->default('Apply for franchisee');
            $table->string('primary_button_url', 500)->default('/#apply');
            $table->string('secondary_button_text', 80)->nullable();
            $table->string('secondary_button_url', 500)->nullable();
            $table->string('image_url', 2048)->nullable();
            $table->boolean('is_published')->default(true);
            $table->unsignedInteger('sort_order')->default(0);
            $table->timestamps();
        });
    }

    public function down(): void { Schema::dropIfExists('hero_slides'); }
};
