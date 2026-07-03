{
  description = "Development flake for Cloudspecs";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forAllSystems = f:
        nixpkgs.lib.genAttrs systems (system:
          f {
            pkgs = import nixpkgs { inherit system; };
          });
    in
    {
      devShells = forAllSystems ({ pkgs }: {
        default = pkgs.mkShell {
          packages = [ pkgs.nodejs_22 ];

          shellHook = ''
            echo "Cloudspecs dev shell"
            echo "Run: npm ci"
            echo "Then: npm run dev"
          '';
        };
      });

      apps = forAllSystems ({ pkgs }: {
        default = {
          type = "app";
          program = "${pkgs.writeShellApplication {
            name = "cloudspecs-preview";
            runtimeInputs = [ pkgs.nodejs_22 ];
            text = ''
              if [ ! -f package.json ]; then
                echo "Run nix run from the repository root." >&2
                exit 1
              fi

              npm ci
              npm run build
              exec npm run preview
            '';
          }}/bin/cloudspecs-preview";
        };
      });
    };
}
