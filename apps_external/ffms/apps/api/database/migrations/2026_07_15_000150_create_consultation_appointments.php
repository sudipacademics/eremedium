<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('consultation_appointments', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->string('name', 120);
            $table->string('email', 160)->index();
            $table->string('mobile', 20)->index();
            $table->date('preferred_date')->index();
            $table->string('preferred_time', 60);
            $table->string('topic', 180);
            $table->text('notes')->nullable();
            $table->string('source')->default('website');
            $table->string('status')->default('requested')->index();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('consultation_appointments');
    }
};
