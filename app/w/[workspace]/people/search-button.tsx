"use client";

import { SearchIcon } from "lucide-react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";

export function SearchButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="brand" size="lg" shape="pill" loading={pending}>
      {!pending && <SearchIcon />}
      Search
    </Button>
  );
}
