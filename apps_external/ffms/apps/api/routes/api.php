<?php

use Illuminate\Support\Facades\Route;
use App\Http\Controllers\Api\V1\AuthController;
use App\Http\Controllers\Api\V1\LeadController;
use App\Http\Controllers\Api\V1\CmsController;
use App\Http\Controllers\Api\V1\ConsultationAppointmentController;

Route::prefix('v1')->group(function (): void {
    Route::get('/health', fn () => response()->json([
        'success' => true,
        'data' => ['service' => 'rfms-api', 'status' => 'ok', 'version' => 'v1'],
    ]));
    Route::post('/auth/applicants/register', [AuthController::class, 'registerApplicant']);
    Route::post('/auth/otp/request', [AuthController::class, 'requestOtp']);
    Route::post('/auth/otp/verify', [AuthController::class, 'verifyOtp']);
    Route::post('/leads/public', [LeadController::class, 'storePublic']);
    Route::post('/appointments/public', [ConsultationAppointmentController::class, 'storePublic']);
    Route::get('/content/success-stories', [CmsController::class, 'publicStories']);
    Route::get('/content/hero-slides', [CmsController::class, 'publicHeroSlides']);
    Route::get('/content/featured-franchisees', [CmsController::class, 'publicFeaturedFranchisees']);
    Route::get('/content/settings', [CmsController::class, 'settings']);
    Route::middleware('auth:sanctum')->post('/auth/logout', [AuthController::class, 'logout']);
    Route::middleware(['auth:sanctum', 'permission:leads.view'])->get('/leads', [LeadController::class, 'index']);
    Route::middleware(['auth:sanctum', 'permission:leads.view'])->get('/appointments', [ConsultationAppointmentController::class, 'index']);
    Route::middleware(['auth:sanctum', 'permission:leads.manage'])->patch('/leads/{lead}', [LeadController::class, 'update']);
    Route::middleware(['auth:sanctum', 'permission:leads.manage'])->post('/leads/{lead}/convert', [LeadController::class, 'convert']);
    Route::middleware(['auth:sanctum', 'permission:content.manage'])->group(function (): void {
        Route::put('/admin/content/settings/{key}', [CmsController::class, 'updateSetting']);
        Route::post('/admin/content/company-profile/logo', [CmsController::class, 'uploadCompanyLogo']);
        Route::get('/admin/content/hero-slides', [CmsController::class, 'indexHeroSlides']);
        Route::post('/admin/content/hero-slides', [CmsController::class, 'storeHeroSlide']);
        Route::patch('/admin/content/hero-slides/{heroSlide}', [CmsController::class, 'updateHeroSlide']);
        Route::delete('/admin/content/hero-slides/{heroSlide}', [CmsController::class, 'destroyHeroSlide']);
        Route::post('/admin/content/hero-slides/image', [CmsController::class, 'uploadHeroImage']);
        Route::get('/admin/content/success-stories', [CmsController::class, 'indexStories']);
        Route::post('/admin/content/success-stories', [CmsController::class, 'storeStory']);
        Route::patch('/admin/content/success-stories/{successStory}', [CmsController::class, 'updateStory']);
        Route::delete('/admin/content/success-stories/{successStory}', [CmsController::class, 'destroyStory']);
        Route::get('/admin/content/featured-franchisees', [CmsController::class, 'indexFeaturedFranchisees']);
        Route::post('/admin/content/featured-franchisees', [CmsController::class, 'storeFeaturedFranchisee']);
        Route::patch('/admin/content/featured-franchisees/{featuredFranchisee}', [CmsController::class, 'updateFeaturedFranchisee']);
        Route::delete('/admin/content/featured-franchisees/{featuredFranchisee}', [CmsController::class, 'destroyFeaturedFranchisee']);
        Route::post('/admin/content/featured-franchisees/image', [CmsController::class, 'uploadFeaturedImage']);
    });
});
