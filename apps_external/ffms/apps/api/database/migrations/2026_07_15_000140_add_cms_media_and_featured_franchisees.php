<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('success_stories', function (Blueprint $table): void {
            $table->text('youtube_embed_url')->nullable()->after('youtube_embed_code');
        });

        Schema::create('featured_franchisees', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->string('name', 160);
            $table->string('location', 180);
            $table->enum('franchise_type', ['FOFO', 'FOCO']);
            $table->string('image_url', 2048);
            $table->boolean('is_featured')->default(true);
            $table->unsignedInteger('sort_order')->default(0);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('featured_franchisees');
        Schema::table('success_stories', function (Blueprint $table): void {
            $table->dropColumn('youtube_embed_url');
        });
    }
};
