<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Responses\ApiResponse;
use App\Models\FeaturedFranchisee;
use App\Models\HeroSlide;
use App\Models\SuccessStory;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class CmsController extends Controller
{
    public function publicStories()
    {
        return ApiResponse::success(
            SuccessStory::query()
                ->where('is_published', true)
                ->orderBy('sort_order')
                ->get(['id', 'title', 'youtube_embed_url', 'sort_order'])
        );
    }

    public function publicHeroSlides()
    {
        return ApiResponse::success(HeroSlide::query()->where('is_published', true)->orderBy('sort_order')->get([
            'id', 'title', 'description', 'primary_button_text', 'primary_button_url', 'secondary_button_text', 'secondary_button_url', 'image_url', 'sort_order',
        ]));
    }

    public function publicFeaturedFranchisees()
    {
        return ApiResponse::success(
            FeaturedFranchisee::query()
                ->where('is_featured', true)
                ->orderBy('sort_order')
                ->get(['id', 'name', 'location', 'franchise_type', 'image_url', 'sort_order'])
        );
    }

    public function settings()
    {
        $stored = DB::table('cms_settings')->where('key', 'company-profile')->value('value');
        return ApiResponse::success($this->companyProfile(json_decode($stored ?? '{}', true)));
    }

    public function updateSetting(Request $request, string $key)
    {
        $data = $request->validate(['value' => [$key === 'company-profile' ? 'required' : 'nullable']]);
        $value = $key === 'company-profile' ? $this->companyProfile((array) $data['value']) : $data['value'];
        DB::table('cms_settings')->updateOrInsert(
            ['key' => $key],
            ['value' => json_encode($value), 'updated_at' => now(), 'created_at' => now()]
        );

        return ApiResponse::success(['key' => $key, 'value' => $value]);
    }

    public function uploadCompanyLogo(Request $request)
    {
        $data = $request->validate(['data_url' => ['required', 'string', 'max:7500000']]);
        if (! preg_match('/^data:image\/(png|jpeg|webp);base64,([a-zA-Z0-9+\/=\r\n]+)$/', $data['data_url'], $matches)) {
            throw ValidationException::withMessages(['data_url' => 'Upload a PNG, JPG or WEBP logo.']);
        }

        $binary = base64_decode($matches[2], true);
        if ($binary === false || strlen($binary) === 0 || strlen($binary) > 5 * 1024 * 1024) {
            throw ValidationException::withMessages(['data_url' => 'The logo must be smaller than 5 MB.']);
        }

        $extension = $matches[1] === 'jpeg' ? 'jpg' : $matches[1];
        $path = 'company-profile/' . Str::uuid() . '.' . $extension;
        Storage::disk('public')->put($path, $binary);

        $stored = DB::table('cms_settings')->where('key', 'company-profile')->value('value');
        $profile = $this->companyProfile(json_decode($stored ?? '{}', true));
        $profile['logo_url'] = $request->getSchemeAndHttpHost() . Storage::disk('public')->url($path);
        DB::table('cms_settings')->updateOrInsert(
            ['key' => 'company-profile'],
            ['value' => json_encode($profile), 'updated_at' => now(), 'created_at' => now()]
        );

        return ApiResponse::success($profile, 201);
    }

    public function indexHeroSlides() { return ApiResponse::success(HeroSlide::query()->orderBy('sort_order')->get()); }

    public function storeHeroSlide(Request $request)
    {
        return ApiResponse::success(HeroSlide::create([...$this->validatedHeroSlide($request), 'id' => (string) Str::uuid()]), 201);
    }

    public function updateHeroSlide(Request $request, HeroSlide $heroSlide)
    {
        $heroSlide->update($this->validatedHeroSlide($request));
        return ApiResponse::success($heroSlide->fresh());
    }

    public function destroyHeroSlide(HeroSlide $heroSlide)
    {
        $heroSlide->delete();
        return ApiResponse::success(['message' => 'Hero slide deleted.']);
    }

    public function uploadHeroImage(Request $request)
    {
        $data = $request->validate(['data_url' => ['required', 'string', 'max:7500000']]);
        if (! preg_match('/^data:image\/(png|jpeg|webp);base64,([a-zA-Z0-9+\/=\r\n]+)$/', $data['data_url'], $matches)) {
            throw ValidationException::withMessages(['data_url' => 'Upload a PNG, JPG or WEBP image.']);
        }
        $binary = base64_decode($matches[2], true);
        if ($binary === false || strlen($binary) === 0 || strlen($binary) > 5 * 1024 * 1024) {
            throw ValidationException::withMessages(['data_url' => 'The image must be smaller than 5 MB.']);
        }
        $extension = $matches[1] === 'jpeg' ? 'jpg' : $matches[1];
        $path = 'hero-slides/' . Str::uuid() . '.' . $extension;
        Storage::disk('public')->put($path, $binary);
        return ApiResponse::success(['image_url' => $request->getSchemeAndHttpHost() . Storage::disk('public')->url($path)], 201);
    }

    public function indexStories()
    {
        return ApiResponse::success(SuccessStory::query()->orderBy('sort_order')->get());
    }

    public function storeStory(Request $request)
    {
        $data = $this->validatedStory($request);
        return ApiResponse::success(SuccessStory::create([...$data, 'id' => (string) Str::uuid()]), 201);
    }

    public function updateStory(Request $request, SuccessStory $successStory)
    {
        $successStory->update($this->validatedStory($request));
        return ApiResponse::success($successStory->fresh());
    }

    public function destroyStory(SuccessStory $successStory)
    {
        $successStory->delete();
        return ApiResponse::success(['message' => 'Success story deleted.']);
    }

    public function indexFeaturedFranchisees()
    {
        return ApiResponse::success(FeaturedFranchisee::query()->orderBy('sort_order')->get());
    }

    public function storeFeaturedFranchisee(Request $request)
    {
        $data = $this->validatedFranchisee($request);
        return ApiResponse::success(FeaturedFranchisee::create([...$data, 'id' => (string) Str::uuid()]), 201);
    }

    public function updateFeaturedFranchisee(Request $request, FeaturedFranchisee $featuredFranchisee)
    {
        $featuredFranchisee->update($this->validatedFranchisee($request));
        return ApiResponse::success($featuredFranchisee->fresh());
    }

    public function destroyFeaturedFranchisee(FeaturedFranchisee $featuredFranchisee)
    {
        $featuredFranchisee->delete();
        return ApiResponse::success(['message' => 'Featured franchisee deleted.']);
    }

    public function uploadFeaturedImage(Request $request)
    {
        $request->validate(['image' => ['required', 'image', 'mimes:jpg,jpeg,png,webp', 'max:5120']]);
        $path = $request->file('image')->store('featured-franchisees', 'public');
        $url = $request->getSchemeAndHttpHost() . Storage::disk('public')->url($path);

        return ApiResponse::success(['image_url' => $url], 201);
    }

    private function validatedStory(Request $request): array
    {
        $data = $request->validate([
            'title' => ['required', 'string', 'max:180'],
            'youtube_embed_code' => ['required', 'string', 'max:5000'],
            'is_published' => ['boolean'],
            'sort_order' => ['integer', 'min:0'],
        ]);

        $data['youtube_embed_url'] = $this->youtubeEmbedUrl($data['youtube_embed_code']);
        return $data;
    }

    private function validatedFranchisee(Request $request): array
    {
        return $request->validate([
            'name' => ['required', 'string', 'max:160'],
            'location' => ['required', 'string', 'max:180'],
            'franchise_type' => ['required', 'in:FOFO,FOCO'],
            'image_url' => ['required', 'url', 'max:2048'],
            'is_featured' => ['boolean'],
            'sort_order' => ['integer', 'min:0'],
        ]);
    }

    private function validatedHeroSlide(Request $request): array
    {
        return $request->validate([
            'title' => ['required', 'string', 'max:220'],
            'description' => ['nullable', 'string', 'max:1600'],
            'primary_button_text' => ['required', 'string', 'max:80'],
            'primary_button_url' => ['required', 'string', 'max:500'],
            'secondary_button_text' => ['nullable', 'string', 'max:80'],
            'secondary_button_url' => ['nullable', 'string', 'max:500'],
            'image_url' => ['nullable', 'url', 'max:2048'],
            'is_published' => ['boolean'],
            'sort_order' => ['integer', 'min:0'],
        ]);
    }

    private function youtubeEmbedUrl(string $embedCode): string
    {
        preg_match('/<iframe[^>]+src=["\']([^"\']+)["\']/i', $embedCode, $matches);
        $url = html_entity_decode($matches[1] ?? trim($embedCode));
        $parts = parse_url($url);
        $host = strtolower($parts['host'] ?? '');
        $path = $parts['path'] ?? '';
        $allowedHosts = ['www.youtube.com', 'youtube.com', 'www.youtube-nocookie.com', 'youtube-nocookie.com'];

        if (($parts['scheme'] ?? '') !== 'https' || ! in_array($host, $allowedHosts, true) || ! str_starts_with($path, '/embed/')) {
            throw ValidationException::withMessages(['youtube_embed_code' => 'Paste a valid HTTPS YouTube iframe embed code.']);
        }

        return $url;
    }

    private function companyProfile(array $value): array
    {
        $defaults = [
            'company_name' => 'Remedium Lab',
            'legal_name' => 'Remedium Lab',
            'logo_url' => '/remedium-lab-logo.png',
            'franchise_hub_name' => 'Remedium Lab Franchisee Hub',
            'office_address' => 'ASO210, Astra Towers, 2C/1, AA II, C, Newtown, Reckjoani, Kolkata, West Bengal 700156',
            'company_email' => '',
            'company_phone' => '',
        ];

        foreach ($defaults as $key => $fallback) {
            $candidate = is_string($value[$key] ?? null) ? trim($value[$key]) : '';
            $defaults[$key] = $candidate !== '' ? $candidate : $fallback;
        }

        if (! str_starts_with($defaults['logo_url'], '/') && ! filter_var($defaults['logo_url'], FILTER_VALIDATE_URL)) {
            $defaults['logo_url'] = '/remedium-lab-logo.png';
        }

        return $defaults;
    }
}
