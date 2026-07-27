<?php namespace App\Contracts; interface VideoKycProviderInterface { public function createSession(array $appointment): array; }
