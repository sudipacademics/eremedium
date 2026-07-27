<?php namespace App\Contracts; interface PaymentGatewayInterface { public function createOrder(array $payment): array; public function verifyWebhook(string $payload, string $signature): bool; }
