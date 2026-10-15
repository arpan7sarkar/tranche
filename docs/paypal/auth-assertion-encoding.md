# PayPal-Auth-Assertion encoding

`authAssertion` in `packages/paypal/src/http.ts` encodes both JWT parts as padded standard Base64, the form the P4 US authorization and capture run proved against the real sandbox, instead of the unpadded base64url the H2 plan specified.
