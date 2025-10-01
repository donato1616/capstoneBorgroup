/** @type {import('tailwindcss').Config} */
export default {
    content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
    theme: {
      extend: {
        colors: {
          olive: {
            50:"#f3f6f1",100:"#e6eee2",200:"#c9dcc0",300:"#a9c79b",
            400:"#88b076",500:"#6e9d5e",600:"#567a4a",
            700:"#415e39",800:"#31472b",900:"#253623"
          }
        },
        fontFamily: { sans: ["Inter","system-ui","Segoe UI","Roboto","Helvetica","Arial","sans-serif"] },
        borderRadius: { xl:"0.875rem","2xl":"1.25rem" },
        boxShadow: { card:"0 1px 2px rgba(16,24,40,.06), 0 1px 3px rgba(16,24,40,.1)" }
      }
    },
    darkMode: "class",
    plugins: [],
  };
  