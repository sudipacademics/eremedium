<?php

namespace Database\Seeders;

use App\Models\Permission;
use App\Models\Role;
use App\Models\User;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
// use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    /**
     * Seed the application's database.
     */
    public function run(): void
    {
        $permissions = collect([
            'leads.view', 'leads.manage', 'applicants.view', 'applicants.review',
            'territories.manage', 'kyc.review', 'agreements.manage', 'payments.review',
            'training.manage', 'support.manage', 'reports.view', 'users.manage', 'content.manage',
        ])->mapWithKeys(fn (string $key) => [$key => Permission::firstOrCreate(['key' => $key], ['id' => (string) Str::uuid(), 'label' => str_replace('.', ' ', $key)])]);
        $admin = Role::firstOrCreate(['name' => 'super_admin'], ['id' => (string) Str::uuid(), 'label' => 'Super Admin']);
        $officer = Role::firstOrCreate(['name' => 'franchise_officer'], ['id' => (string) Str::uuid(), 'label' => 'Franchise Officer']);
        $applicant = Role::firstOrCreate(['name' => 'applicant'], ['id' => (string) Str::uuid(), 'label' => 'Franchise Applicant']);
        $admin->permissions()->sync($permissions->pluck('id'));
        $officer->permissions()->sync($permissions->only(['leads.view', 'leads.manage', 'applicants.view', 'applicants.review', 'territories.manage', 'kyc.review'])->pluck('id'));
        User::updateOrCreate(['email' => 'admin@remediumlab.local'], ['name' => 'RFMS Super Admin', 'mobile' => '9000000000', 'password' => Hash::make('Admin@12345'), 'role_id' => $admin->id, 'status' => 'active']);
        User::updateOrCreate(['email' => 'officer@remediumlab.local'], ['name' => 'Demo Officer', 'mobile' => '9000000001', 'password' => Hash::make('Demo@12345'), 'role_id' => $officer->id, 'status' => 'active']);
        User::updateOrCreate(['email' => 'applicant@remediumlab.local'], ['name' => 'Demo Applicant', 'mobile' => '9000000002', 'password' => Hash::make('Demo@12345'), 'role_id' => $applicant->id, 'status' => 'active']);
    }
}
