-- 0005: upload tokens go in links (/u/<token>). Base64 contains "/" and "+", which break URLs: use 128-bit hex.
alter table public.tests alter column upload_token set default encode(gen_random_bytes(16), 'hex');
update public.tests set upload_token = encode(gen_random_bytes(16), 'hex') where upload_token !~ '^[0-9a-f]{32}$';
