-- Migration: Grant 2000 real AX tokens to user AX559112
UPDATE public.users 
SET balance = 2000 
WHERE username = 'AX559112' 
   OR id::text = 'AX559112' 
   OR id::text = '559112';
