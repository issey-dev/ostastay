# APP STANDARD 001 - Form Validation
All forms in this application MUST use Zod and React Hook Form with shadcn/ui components to provide strict, inline, real-time validation before submitting to the API.

**Rules:**
1. **Schema Definition**: Define a Zod schema (`z.object`) mapping all fields.
2. **React Hook Form**: Use `useForm` with `@hookform/resolvers/zod` and `mode: "onChange"`.
3. **UI Integration**: Wrap all inputs in shadcn/ui's `<Form>`, `<FormField>`, `<FormItem>`, `<FormLabel>`, `<FormControl>`, and `<FormMessage>` components.
4. **Validation Specifics**:
   - `email` must use `.email()` validation.
   - `firstName` and `lastName` are required for Guests.
   - `companyName` is required for Companies and Travel Agents.
   - **Date of Birth** must NEVER be a future date (use `.max(new Date())` or `.refine`).
   - Document Expiry Date must be a future date (use `.min(new Date())` or `.refine`).
