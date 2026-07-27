<?php namespace App\Contracts; interface OtpProviderInterface { public function send(string $phone, string $message): string; public function verify(string $reference, string $code): bool; }
